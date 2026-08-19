/**
 * PINCH vs FIST regression test.
 *
 * A clenched fist puts the thumb tip right next to the index tip, so the naive
 * "are they close?" test claims every fist is a pinch. Because the recognizer
 * checks PINCH first and returns early, that made PUNCH silently fire GRAB.
 * The index-reach test is what separates them - keep it working.
 *
 *   npm run test:pinch
 */
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');

function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['fingerpose']
  });
  const m = { exports: {} };
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, m, m.exports);
  return m.exports;
}

const { GestureClassifier } = load('src/gestures/GestureClassifier.ts');

const PINCH_RATIO_THRESHOLD = 0.34;
const PINCH_MIN_INDEX_REACH = 1.25;

const P = (a) => a.map(([x, y]) => ({ x, y, z: 0 }));

// Normalised landmarks: wrist 0, thumb 1-4, index 5-8, middle 9-12, ring 13-16, pinky 17-20.
const CASES = {
  'TIGHT FIST': {
    shouldBePinch: false,
    landmarks: P([
      [0.50, 0.80], [0.44, 0.74], [0.40, 0.68], [0.42, 0.63], [0.46, 0.61],
      [0.46, 0.62], [0.45, 0.55], [0.47, 0.58], [0.48, 0.62],
      [0.50, 0.61], [0.50, 0.54], [0.52, 0.57], [0.53, 0.61],
      [0.54, 0.62], [0.55, 0.55], [0.56, 0.58], [0.57, 0.62],
      [0.58, 0.64], [0.59, 0.58], [0.60, 0.61], [0.60, 0.64]
    ])
  },
  'FIST (thumb out)': {
    shouldBePinch: false,
    landmarks: P([
      [0.50, 0.80], [0.42, 0.75], [0.36, 0.70], [0.32, 0.66], [0.29, 0.62],
      [0.46, 0.62], [0.45, 0.55], [0.47, 0.58], [0.48, 0.62],
      [0.50, 0.61], [0.50, 0.54], [0.52, 0.57], [0.53, 0.61],
      [0.54, 0.62], [0.55, 0.55], [0.56, 0.58], [0.57, 0.62],
      [0.58, 0.64], [0.59, 0.58], [0.60, 0.61], [0.60, 0.64]
    ])
  },
  'REAL PINCH': {
    shouldBePinch: true,
    landmarks: P([
      [0.50, 0.80], [0.44, 0.74], [0.40, 0.67], [0.40, 0.60], [0.44, 0.54],
      [0.46, 0.62], [0.44, 0.52], [0.44, 0.48], [0.45, 0.54],
      [0.50, 0.61], [0.50, 0.54], [0.52, 0.57], [0.53, 0.61],
      [0.54, 0.62], [0.55, 0.55], [0.56, 0.58], [0.57, 0.62],
      [0.58, 0.64], [0.59, 0.58], [0.60, 0.61], [0.60, 0.64]
    ])
  }
};

let passed = 0;
const total = Object.keys(CASES).length;

for (const [label, testCase] of Object.entries(CASES)) {
  const ratio = GestureClassifier.pinchRatio(testCase.landmarks);
  const curled = GestureClassifier.longFingersCurled(testCase.landmarks);
  const reach = GestureClassifier.indexReach(testCase.landmarks);

  const isPinch = ratio < PINCH_RATIO_THRESHOLD && curled && reach > PINCH_MIN_INDEX_REACH;
  const ok = isPinch === testCase.shouldBePinch;
  if (ok) passed++;

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(18)} ratio=${ratio.toFixed(3)} reach=${reach.toFixed(3)}` +
      ` -> ${isPinch ? 'PINCH' : 'not pinch'} (expected ${testCase.shouldBePinch ? 'PINCH' : 'not pinch'})`
  );
}

console.log(`\n${passed}/${total} pinch/fist cases classified correctly`);
process.exit(passed === total ? 0 : 1);
