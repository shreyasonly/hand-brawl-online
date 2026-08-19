import fp from 'fingerpose';
import { Gesture, FINGERPOSE_MIN_SCORE } from './GestureConfig';
import { KNOWN_GESTURES } from './handGestures';
import { GestureClassifier, Landmark } from './GestureClassifier';
import { HandFrame } from '../vision/HandTracker';

export interface RecognizedGesture {
  gesture: Gesture;
  /** 0..1 */
  confidence: number;
  /** Debug readout: per-finger curl / direction, as fingerpose sees it. */
  poseData: string[][];
}

const PINCH_RATIO_THRESHOLD = 0.34;

/**
 * Turns 21 hand landmarks into one of the six HAND BRAWL gestures.
 *
 * Primary path : fingerpose GestureEstimator (the technique used by the
 *                reference project) scoring the live hand against the
 *                descriptions in handGestures.ts.
 * PINCH        : geometric thumb-tip / index-tip test, which fingerpose's
 *                curl+direction model cannot represent.
 * Fallback     : the project's original geometric classifier, so the game keeps
 *                responding when fingerpose is undecided.
 */
export class GestureRecognizer {
  private estimator = new fp.GestureEstimator(KNOWN_GESTURES);

  public recognize(frame: HandFrame | null): RecognizedGesture {
    if (!frame || frame.landmarksPx.length < 21) {
      return { gesture: Gesture.NONE, confidence: 0, poseData: [] };
    }

    const normalized: Landmark[] = frame.landmarksNorm;

    // 1. PINCH wins outright - it is geometrically unambiguous.
    if (
      GestureClassifier.pinchRatio(normalized) < PINCH_RATIO_THRESHOLD &&
      GestureClassifier.longFingersCurled(normalized)
    ) {
      return { gesture: Gesture.PINCH, confidence: 0.9, poseData: [] };
    }

    // 2. Fingerpose scoring against the known descriptions.
    let poseData: string[][] = [];
    try {
      const result = this.estimator.estimate(frame.landmarksPx, FINGERPOSE_MIN_SCORE);
      poseData = result.poseData;

      if (result.gestures.length > 0) {
        const best = result.gestures.reduce((a, b) => (b.score > a.score ? b : a));
        return {
          gesture: best.name as Gesture,
          confidence: Math.min(1, best.score / 10),
          poseData
        };
      }
    } catch (err) {
      console.warn('fingerpose estimation failed', err);
    }

    // 3. Geometric fallback.
    const fallback = GestureClassifier.classify(normalized);
    return {
      gesture: fallback.gesture,
      // Discount the fallback slightly so fingerpose stays the preferred source.
      confidence: fallback.gesture === Gesture.NONE ? 0 : fallback.confidence * 0.9,
      poseData
    };
  }
}
