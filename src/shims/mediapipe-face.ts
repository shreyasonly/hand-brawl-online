/**
 * Shim for `@mediapipe/face_detection` - same runtime-export problem as
 * mediapipe-hands.ts. @tensorflow-models/face-detection does
 * `import { FaceDetection } from '@mediapipe/face_detection'`, and the UMD
 * registers it at runtime via `K("FaceDetection", ...)`.
 */
const globalScope = globalThis as unknown as Record<string, unknown>;

export const FaceDetection = globalScope.FaceDetection as
  | (new (config: { locateFile?: (file: string) => string }) => unknown)
  | undefined;

export const FACE_VERSION = '0.4.1646425229';
export const FACE_SOLUTION_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@${FACE_VERSION}`;
