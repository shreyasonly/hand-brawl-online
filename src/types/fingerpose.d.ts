/**
 * Type declarations for `fingerpose` (v0.1.0 ships without types).
 *
 * Landmarks are the 21 hand keypoints returned by the TensorFlow.js handpose /
 * MediaPipe Hands models, expressed as `[x, y, z]` tuples in image pixel space
 * (y grows downward) - exactly the format used by the reference project
 * https://github.com/chaitanya-chafale/Hand-Gesture-Gaming
 */
declare module 'fingerpose' {
  export type Landmark3D = [number, number, number];

  export const Finger: {
    Thumb: 0; Index: 1; Middle: 2; Ring: 3; Pinky: 4;
    all: number[];
    getName(value: number): string;
    getPoints(value: number): number[][];
  };

  export const FingerCurl: {
    NoCurl: 0; HalfCurl: 1; FullCurl: 2;
    getName(value: number): string;
  };

  export const FingerDirection: {
    VerticalUp: 0;
    VerticalDown: 1;
    HorizontalLeft: 2;
    HorizontalRight: 3;
    DiagonalUpRight: 4;
    DiagonalUpLeft: 5;
    DiagonalDownRight: 6;
    DiagonalDownLeft: 7;
    getName(value: number): string;
  };

  export class GestureDescription {
    constructor(name: string);
    name: string;
    addCurl(finger: number, curl: number, contrib?: number): void;
    addDirection(finger: number, direction: number, contrib?: number): void;
    matchAgainst(curls: number[], directions: number[]): number;
  }

  export interface EstimatedGesture {
    name: string;
    /** 0 - 10 confidence score */
    score: number;
  }

  export interface EstimatorResult {
    poseData: string[][];
    gestures: EstimatedGesture[];
  }

  export class GestureEstimator {
    constructor(knownGestures: GestureDescription[], estimatorOptions?: Record<string, number>);
    estimate(landmarks: Landmark3D[] | number[][], minScore: number): EstimatorResult;
  }

  const fp: {
    GestureEstimator: typeof GestureEstimator;
    GestureDescription: typeof GestureDescription;
    Finger: typeof Finger;
    FingerCurl: typeof FingerCurl;
    FingerDirection: typeof FingerDirection;
    Gestures: Record<string, GestureDescription>;
  };

  export default fp;
}
