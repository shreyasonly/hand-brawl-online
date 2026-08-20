/**
 * One-shot go-live for online play. Run from the project root:
 *
 *   node scripts/go-live.cjs https://hand-brawl-server-XXXX.onrender.com
 *
 * Given the deployed Colyseus server URL, this script:
 *   1. waits for the server's /health endpoint (tolerates Render cold starts),
 *   2. opens a REAL Colyseus connection and creates+joins a room (two clients),
 *   3. sets VITE_GAME_SERVER_URL in Vercel (Production + Preview),
 *   4. redeploys the frontend to production,
 *   5. verifies the deployed bundle actually contains the server host.
 *
 * Flags:
 *   --check-only   run steps 1-2 only (no Vercel changes)
 */
const { execSync } = require('child_process');
const { Client } = require('@colyseus/sdk');

const VERCEL_SCOPE = 'shreya-8d78f79d';
const PROD_URL = 'https://hand-brawl-online.vercel.app';

const rawArg = process.argv[2];
const checkOnly = process.argv.includes('--check-only');

if (!rawArg) {
  console.error('Usage: node scripts/go-live.cjs <server-url> [--check-only]');
  console.error('  e.g. node scripts/go-live.cjs https://hand-brawl-server-abc1.onrender.com');
  process.exit(1);
}

// Normalize whatever was pasted: http(s) or ws(s), with or without trailing /.
const host = rawArg.trim().replace(/^(https?|wss?):\/\//, '').replace(/\/+$/, '');
const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
const httpUrl = `${isLocal ? 'http' : 'https'}://${host}`;
const wsUrl = `${isLocal ? 'ws' : 'wss'}://${host}`;

const log = (m) => console.log(`\n== ${m} ==`);
const ok = (m) => console.log(`  PASS  ${m}`);
const die = (m) => {
  console.error(`  FAIL  ${m}`);
  process.exit(1);
};

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  // ---- 1. Health (a free Render instance may need ~60s to cold-start) ----
  log(`Waiting for ${httpUrl}/health`);
  const deadline = Date.now() + 180000;
  for (;;) {
    try {
      const res = await fetchWithTimeout(`${httpUrl}/health`, 10000);
      if (res.ok) break;
      console.log(`  ... /health returned ${res.status}, retrying`);
    } catch {
      console.log('  ... not up yet (cold start?), retrying');
    }
    if (Date.now() > deadline) die('server /health never came up (3 min). Is the URL right?');
    await new Promise((r) => setTimeout(r, 5000));
  }
  ok('server is up');

  // ---- 2. Real Colyseus round-trip: create + join a room ----
  log(`Colyseus connection test against ${wsUrl}`);
  // Random code from the game's real alphabet (no O/0/I/1).
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  const c1 = new Client(wsUrl);
  const c2 = new Client(wsUrl);
  const r1 = await c1.create('hand_brawl', { roomCode: code }).catch((e) => die(`create failed: ${e.message}`));
  const r2 = await c2.join('hand_brawl', { roomCode: code }).catch((e) => die(`join failed: ${e.message}`));
  await new Promise((r) => setTimeout(r, 800));
  const slots = [r1.state?.players?.get('p1')?.slot, r1.state?.players?.get('p2')?.slot];
  if (slots[0] !== 'p1' || slots[1] !== 'p2') die(`slot assignment wrong: ${JSON.stringify(slots)}`);
  ok('room created, second client joined, server assigned p1/p2');
  await r2.leave();
  await r1.leave();

  if (checkOnly) {
    console.log('\nCHECK-ONLY DONE - server is ready for players.');
    process.exit(0);
  }

  // ---- 3. Vercel env vars (Production + Preview) ----
  log(`Setting VITE_GAME_SERVER_URL=${wsUrl} in Vercel`);
  const sh = (cmd, allowFail = false) => {
    try {
      return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    } catch (e) {
      if (!allowFail) die(`command failed: ${cmd}\n${e.stderr?.toString() ?? e.message}`);
      return '';
    }
  };
  for (const target of ['production', 'preview']) {
    sh(`vercel env rm VITE_GAME_SERVER_URL ${target} --yes --scope ${VERCEL_SCOPE}`, true);
    const add = `node -e "process.stdout.write('${wsUrl}')" | vercel env add VITE_GAME_SERVER_URL ${target} --scope ${VERCEL_SCOPE}`;
    execSync(add, { stdio: 'inherit', shell: true });
    ok(`env set for ${target}`);
  }

  // ---- 4. Redeploy production (env is inlined at build time) ----
  log('Redeploying the frontend to production');
  execSync(`vercel deploy --prod --yes --scope ${VERCEL_SCOPE}`, { stdio: 'inherit', shell: true });
  ok('deployed');

  // ---- 5. Verify the live bundle contains the server host ----
  log('Verifying the live bundle');
  const html = await (await fetchWithTimeout(PROD_URL, 15000)).text();
  const asset = html.match(/assets\/index-[^"']+\.js/)?.[0];
  if (!asset) die('could not find the index bundle in the live HTML');
  const js = await (await fetchWithTimeout(`${PROD_URL}/${asset}`, 20000)).text();
  if (!js.includes(host)) die(`live bundle does not contain ${host} - did the deploy pick up the env?`);
  ok(`live bundle points at ${host}`);

  console.log('\nGO-LIVE COMPLETE.');
  console.log(`Open ${PROD_URL} on two laptops, CREATE + JOIN, and fight.`);
})().catch((e) => die(e.message));
