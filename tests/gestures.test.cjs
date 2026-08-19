/**
 * Gesture description regression test.
 *
 * Bundles the REAL src/gestures/handGestures.ts with esbuild (no duplicated
 * copy to drift out of sync) and checks that every canonical hand pose scores
 * highest against the gesture it is supposed to be, comfortably above the
 * runtime threshold.
 *
 *   npm run test:gestures
 */
const path = require('path');
const esbuild = require('esbuild');
const fp = require('fingerpose');

const { FingerCurl: C, FingerDirection: D } = fp;

const ROOT = path.resolve(__dirname, '..');
const THRESHOLD = 8.0; // runtime uses 7.5, so leave headroom

function loadDescriptions() {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src/gestures/handGestures.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['fingerpose']
  });

  const code = result.outputFiles[0].text;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports.KNOWN_GESTURES;
}

// [thumb, index, middle, ring, pinky]
const CASES = {
  'FIST (tight)': {
    curls: [C.FullCurl, C.FullCurl, C.FullCurl, C.FullCurl, C.FullCurl],
    dirs: [D.HorizontalLeft, D.VerticalUp, D.VerticalUp, D.VerticalUp, D.VerticalUp],
    want: 'FIST'
  },
  'FIST (thumb tucked)': {
    curls: [C.HalfCurl, C.FullCurl, C.FullCurl, C.FullCurl, C.FullCurl],
    dirs: [D.DiagonalUpLeft, D.VerticalUp, D.VerticalUp, D.VerticalUp, D.VerticalUp],
    want: 'FIST'
  },
  'FIST (loose)': {
    curls: [C.HalfCurl, C.HalfCurl, C.FullCurl, C.FullCurl, C.HalfCurl],
    dirs: [D.HorizontalRight, D.VerticalUp, D.VerticalUp, D.VerticalUp, D.VerticalUp],
    want: 'FIST'
  },
  'OPEN PALM': {
    curls: [C.NoCurl, C.NoCurl, C.NoCurl, C.NoCurl, C.NoCurl],
    dirs: [D.DiagonalUpLeft, D.VerticalUp, D.VerticalUp, D.VerticalUp, D.VerticalUp],
    want: 'OPEN_PALM'
  },
  'OPEN PALM (tilted)': {
    curls: [C.NoCurl, C.NoCurl, C.NoCurl, C.NoCurl, C.NoCurl],
    dirs: [D.DiagonalUpLeft, D.DiagonalUpRight, D.VerticalUp, D.VerticalUp, D.DiagonalUpLeft],
    want: 'OPEN_PALM'
  },
  'VICTORY': {
    curls: [C.HalfCurl, C.NoCurl, C.NoCurl, C.FullCurl, C.FullCurl],
    dirs: [D.DiagonalUpLeft, D.VerticalUp, D.DiagonalUpRight, D.VerticalUp, D.VerticalUp],
    want: 'VICTORY'
  },
  'INDEX ONLY': {
    curls: [C.HalfCurl, C.NoCurl, C.FullCurl, C.FullCurl, C.FullCurl],
    dirs: [D.HorizontalLeft, D.VerticalUp, D.VerticalUp, D.VerticalUp, D.VerticalUp],
    want: 'INDEX'
  },
  'THUMBS UP': {
    curls: [C.NoCurl, C.FullCurl, C.FullCurl, C.FullCurl, C.FullCurl],
    dirs: [D.VerticalUp, D.HorizontalLeft, D.HorizontalLeft, D.HorizontalLeft, D.HorizontalLeft],
    want: 'THUMBS_UP'
  },
  'THUMBS UP (tilted)': {
    curls: [C.NoCurl, C.FullCurl, C.FullCurl, C.FullCurl, C.FullCurl],
    dirs: [D.DiagonalUpRight, D.DiagonalUpLeft, D.HorizontalLeft, D.HorizontalLeft, D.HorizontalLeft],
    want: 'THUMBS_UP'
  }
};

const descriptions = loadDescriptions();
let passed = 0;
const total = Object.keys(CASES).length;

for (const [label, testCase] of Object.entries(CASES)) {
  const scores = descriptions
    .map((d) => ({ name: d.name, score: d.matchAgainst(testCase.curls, testCase.dirs) }))
    .sort((a, b) => b.score - a.score);

  const top = scores[0];
  const ok = top.name === testCase.want && top.score >= THRESHOLD;
  if (ok) passed++;

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(21)} -> ${top.name.padEnd(10)} ${top.score.toFixed(2)}` +
      `   (runner-up ${scores[1].name} ${scores[1].score.toFixed(2)})`
  );
}

console.log(`\n${passed}/${total} gesture poses classified correctly at score >= ${THRESHOLD}`);
process.exit(passed === total ? 0 : 1);
