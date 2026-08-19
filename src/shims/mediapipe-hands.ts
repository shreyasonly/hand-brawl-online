/**
 * Shim for `@mediapipe/hands`.
 *
 * @tensorflow-models/hand-pose-detection does `import { Hands } from '@mediapipe/hands'`,
 * but that package is a UMD bundle that registers its export at RUNTIME
 * (`za("Hands", ...)`). Vite/Rollup cannot see the named export statically, so
 * the import resolved to `undefined` and every attempt to use the fast
 * MediaPipe runtime failed with "Hands is not a constructor" - silently
 * dropping the game onto the tfjs runtime, which pulls its weights through a
 * tfhub -> kaggle -> googleapis redirect chain that is slow and often fails.
 *
 * index.html loads the real solution as a classic <script>, so it is attached
 * to the global scope before this module (an ES module, therefore deferred)
 * evaluates. Vite aliases '@mediapipe/hands' here.
 */
const globalScope = globalThis as unknown as Record<string, unknown>;

export const Hands = globalScope.Hands as
  | (new (config: { locateFile?: (file: string) => string }) => unknown)
  | undefined;

export const HANDS_VERSION = '0.4.1675469240';
export const HANDS_SOLUTION_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}`;
