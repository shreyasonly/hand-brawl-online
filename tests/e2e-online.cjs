/**
 * Two-browser end-to-end test of ONLINE play against a LOCAL Colyseus server.
 *
 * Prerequisites (three terminals, or run the first two in the background):
 *   1. npm run dev:server         (Colyseus on ws://localhost:2567)
 *   2. npm run dev                (vite on https://localhost:5000)
 *   3. node tests/e2e-online.cjs
 *
 * Drives two real Chrome pages through:
 *   CREATE -> JOIN -> SETUP -> READY x2 -> COUNTDOWN -> FIGHT ->
 *   movement sync -> punches/health sync -> KO -> round 2 -> MATCH_END ->
 *   REMATCH -> unexpected-disconnect -> auto-reconnect.
 */
const { chromium } = require('playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.E2E_URL || 'https://localhost:5000';

const FLAGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--autoplay-policy=no-user-gesture-required'
];

let failures = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const fail = (label, detail) => {
  failures++;
  console.error(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`);
};

async function waitFor(page, fn, timeoutMs, label, arg) {
  const started = Date.now();
  for (;;) {
    let value;
    try {
      value = await page.evaluate(fn, arg);
    } catch (e) {
      value = undefined; // page navigating / evaluating too early
    }
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for: ${label}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

const sceneActive = (name) => `window.__HB && __HB.game.scene.isActive('${name}')`;

async function activeScene(page, name, timeoutMs, who) {
  await waitFor(page, (n) => window.__HB && window.__HB.game.scene.isActive(n), timeoutMs, `${who}: scene ${name}`, name);
  ok(`${who} reached ${name}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: FLAGS });

  const mk = async (who) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      const t = m.text();
      if (/\[(ROOM|PLAYER|READY|BOTH|COUNTDOWN|FIGHT|MATCH|START|LAUNCH|RECONNECT|OPPONENT|NEED)/.test(t)) {
        console.log(`    [${who} console] ${t}`);
      }
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    return page;
  };

  console.log('== Booting two browsers ==');
  const p1 = await mk('P1');
  const p2 = await mk('P2');

  await activeScene(p1, 'MenuScene', 40000, 'P1');
  await activeScene(p2, 'MenuScene', 40000, 'P2');

  // -------------------------------------------------- CREATE (P1)
  console.log('== CREATE ROOM ==');
  await p1.keyboard.press('Enter'); // CREATE LOBBY is the default selection
  const code = await waitFor(
    p1,
    () => {
      const gm = window.__HB.gm();
      return gm.room.roomCode && gm.room.slot === 'p1' ? gm.room.roomCode : null;
    },
    15000,
    'P1: room code + slot p1'
  );
  ok(`P1 created room ${code} as p1`);

  // -------------------------------------------------- JOIN (P2)
  console.log('== JOIN ROOM ==');
  await p2.keyboard.press('ArrowDown');
  await p2.keyboard.press('Enter'); // JOIN LOBBY -> DOM modal
  await p2.waitForSelector('#modal-root:not(.hidden)', { timeout: 8000 });
  await p2.fill('#room-code-input', code);
  await p2.click('#modal-confirm');

  await waitFor(p2, () => window.__HB.gm().room.slot === 'p2', 15000, 'P2: slot p2');
  ok('P2 joined as p2 (server-assigned slot)');

  // Lobby auto-advances both to camera setup when both are present.
  await activeScene(p1, 'SetupScene', 15000, 'P1');
  await activeScene(p2, 'SetupScene', 15000, 'P2');

  // -------------------------------------------------- SETUP -> SELECT
  await p1.keyboard.press('Enter');
  await p2.keyboard.press('Enter');
  await activeScene(p1, 'SelectScene', 10000, 'P1');
  await activeScene(p2, 'SelectScene', 10000, 'P2');

  // -------------------------------------------------- READY x2 -> FIGHT
  console.log('== READY -> COUNTDOWN -> FIGHT ==');
  await p1.keyboard.press('Enter'); // P1 READY
  await new Promise((r) => setTimeout(r, 700));
  await p2.keyboard.press('Enter'); // P2 READY - the SERVER now starts the match

  await activeScene(p1, 'FightScene', 20000, 'P1');
  await activeScene(p2, 'FightScene', 20000, 'P2');

  await waitFor(p1, () => window.__HB.gm().currentState === 'FIGHT_ACTIVE', 20000, 'P1: FIGHT_ACTIVE');
  await waitFor(p2, () => window.__HB.gm().currentState === 'FIGHT_ACTIVE', 20000, 'P2: FIGHT_ACTIVE');
  ok('both clients entered FIGHT_ACTIVE after the server countdown');

  // Round timer within 2s on the two screens
  const t1 = await p1.evaluate(() => window.__HB.scene('FightScene').roundTimer);
  const t2 = await p2.evaluate(() => window.__HB.scene('FightScene').roundTimer);
  Math.abs(t1 - t2) <= 2 ? ok(`round timers in sync (${t1} vs ${t2})`) : fail('round timers diverged', `${t1} vs ${t2}`);

  // -------------------------------------------------- MOVEMENT SYNC
  console.log('== MOVEMENT ==');
  const p1xBefore = await p2.evaluate(() => window.__HB.scene('FightScene').p1.x);
  await p1.keyboard.down('KeyD');
  await new Promise((r) => setTimeout(r, 1500));
  const p1xAfter = await p2.evaluate(() => window.__HB.scene('FightScene').p1.x);
  p1xAfter > p1xBefore + 30
    ? ok(`P1 movement visible on P2's screen (${Math.round(p1xBefore)} -> ${Math.round(p1xAfter)})`)
    : fail('P1 movement not mirrored on P2', `${p1xBefore} -> ${p1xAfter}`);

  // -------------------------------------------------- COMBAT / HEALTH SYNC
  console.log('== COMBAT (punching to KO) ==');
  const hpProbe = () => {
    const s = window.__HB.scene('FightScene');
    return { p1hp: s.p1.hp, p2hp: s.p2.hp, round: window.__HB.gm().currentRound, state: window.__HB.gm().currentState };
  };

  let sawDamage = false;
  const punchUntil = async (cond, label, timeoutMs) => {
    const started = Date.now();
    for (;;) {
      await p1.keyboard.press('KeyJ');
      await new Promise((r) => setTimeout(r, 320));
      const a = await p1.evaluate(hpProbe);
      const b = await p2.evaluate(hpProbe);
      if (!sawDamage && b.p2hp < 90) {
        sawDamage = true;
        ok(`damage visible on both screens (P1 sees ${a.p2hp}, P2 sees ${b.p2hp})`);
        if (Math.abs(a.p2hp - b.p2hp) > 15) fail('hp diverged badly between screens', `${a.p2hp} vs ${b.p2hp}`);
      }
      if (cond(a, b)) return;
      if (Date.now() - started > timeoutMs) throw new Error('timeout: ' + label);
    }
  };

  // Round 1: punch until the round ends (KO) and round 2 begins on BOTH.
  await punchUntil((a, b) => a.round === 2 && b.round === 2, 'round 2 to start on both', 60000);
  await p1.keyboard.up('KeyD');
  ok('round 1 KO -> server announced ROUND 2 on both screens');

  await waitFor(p1, () => window.__HB.gm().currentState === 'FIGHT_ACTIVE', 25000, 'P1: round 2 active');
  await waitFor(p2, () => window.__HB.gm().currentState === 'FIGHT_ACTIVE', 25000, 'P2: round 2 active');

  // Round 2: punch until MATCH_END.
  await p1.keyboard.down('KeyD');
  await punchUntil(
    (a, b) => a.state === 'FIGHT_MATCH_END' && b.state === 'FIGHT_MATCH_END',
    'MATCH_END on both',
    60000
  );
  await p1.keyboard.up('KeyD');

  const w1 = await p1.evaluate(() => window.__HB.gm().matchWinner);
  const w2 = await p2.evaluate(() => window.__HB.gm().matchWinner);
  w1 === 1 && w2 === 1 ? ok('both screens agree: PLAYER 1 wins the match') : fail('winner mismatch', `${w1} vs ${w2}`);

  // -------------------------------------------------- REMATCH
  console.log('== REMATCH ==');
  await p1.keyboard.press('KeyR');
  await new Promise((r) => setTimeout(r, 400));
  await p2.keyboard.press('KeyR');

  await waitFor(p1, () => window.__HB.gm().currentState === 'FIGHT_ACTIVE' && window.__HB.gm().currentRound === 1, 30000, 'P1: rematch active');
  await waitFor(p2, () => window.__HB.gm().currentState === 'FIGHT_ACTIVE' && window.__HB.gm().currentRound === 1, 30000, 'P2: rematch active');
  ok('server restarted the match for both (round 1, fighting)');

  // -------------------------------------------------- DISCONNECT / RECONNECT
  console.log('== UNEXPECTED DISCONNECT + RECONNECT ==');
  // Close P2's websocket WITHOUT consent - simulates a network drop.
  await p2.evaluate(() => {
    const session = window.__HB.gm().room;
    session.room.leave(false);
  });

  await waitFor(
    p1,
    () => {
      const s = window.__HB.scene('FightScene');
      return s.disconnectText.visible && s.disconnectText.text.includes('OPPONENT DISCONNECTED');
    },
    12000,
    'P1: disconnect overlay'
  );
  ok('P1 shows OPPONENT DISCONNECTED (server-confirmed, not guessed)');

  // P2's session auto-reconnects with its reconnection token.
  await waitFor(p2, () => window.__HB.gm().room.status === 'CONNECTED', 25000, 'P2: reconnected');
  ok('P2 auto-reconnected to the same room');

  await waitFor(
    p1,
    () => !window.__HB.scene('FightScene').disconnectText.visible,
    15000,
    'P1: overlay cleared after reconnect'
  );
  ok('P1 overlay cleared - fight resumed');

  const p2SlotAfter = await p2.evaluate(() => window.__HB.gm().room.slot);
  p2SlotAfter === 'p2' ? ok('P2 kept its slot after reconnecting') : fail('P2 slot changed after reconnect', p2SlotAfter);

  // -------------------------------------------------- RESULT
  console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nE2E FAILED:', e.message);
  process.exit(1);
});
