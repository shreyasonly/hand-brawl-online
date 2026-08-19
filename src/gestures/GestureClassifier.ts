import { Gesture } from './GestureConfig';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export class GestureClassifier {
  /**
   * Classify 21 hand landmarks into a Gesture enum with a confidence score (0.0 to 1.0)
   */
  public static classify(landmarks: Landmark[]): { gesture: Gesture; confidence: number } {
    if (!landmarks || landmarks.length < 21) {
      return { gesture: Gesture.NONE, confidence: 0 };
    }

    const wrist = landmarks[0];

    // Check individual finger curl states (true = extended, false = curled)
    const isThumbExtended = this.isThumbExtended(landmarks);
    const isIndexExtended = this.isFingerExtended(landmarks, 5, 6, 7, 8);
    const isMiddleExtended = this.isFingerExtended(landmarks, 9, 10, 11, 12);
    const isRingExtended = this.isFingerExtended(landmarks, 13, 14, 15, 16);
    const isPinkyExtended = this.isFingerExtended(landmarks, 17, 18, 19, 20);

    // Calculate Pinch Distance between Thumb tip (4) and Index tip (8)
    const pinchDist = this.dist(landmarks[4], landmarks[8]);
    const wristIndexDist = this.dist(landmarks[0], landmarks[5]);

    // Normalized pinch ratio relative to hand size
    const pinchRatio = pinchDist / (wristIndexDist || 1);

    // 1. PINCH (🤏): Thumb tip and Index tip touching/pinched close together
    if (pinchRatio < 0.35 && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return { gesture: Gesture.PINCH, confidence: 0.90 };
    }

    // 2. THUMBS_UP (👍): Thumb pointing up, all other fingers curled
    if (isThumbExtended && !isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      const thumbTip = landmarks[4];
      const thumbMcp = landmarks[2];
      if (thumbTip.y < thumbMcp.y) {
        return { gesture: Gesture.THUMBS_UP, confidence: 0.92 };
      }
    }

    // 3. FIST (✊): All 4 fingers curled
    if (!isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return { gesture: Gesture.FIST, confidence: 0.95 };
    }

    // 4. OPEN PALM (✋): All fingers extended
    if (isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended) {
      return { gesture: Gesture.OPEN_PALM, confidence: 0.95 };
    }

    // 5. VICTORY / TWO FINGERS (✌️): Index & Middle extended, Ring & Pinky curled
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return { gesture: Gesture.VICTORY, confidence: 0.92 };
    }

    // 6. INDEX FINGER (☝️): Index extended, Middle, Ring & Pinky curled
    if (isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      return { gesture: Gesture.INDEX, confidence: 0.90 };
    }

    return { gesture: Gesture.NONE, confidence: 0.4 };
  }

  private static isFingerExtended(
    landmarks: Landmark[],
    mcpIdx: number,
    pipIdx: number,
    dipIdx: number,
    tipIdx: number
  ): boolean {
    const wrist = landmarks[0];
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];
    const mcp = landmarks[mcpIdx];

    // Distance from wrist to tip vs wrist to pip
    const dWristTip = this.dist(wrist, tip);
    const dWristPip = this.dist(wrist, pip);

    // Tip-to-MCP vertical/horizontal displacement relative to PIP
    const dTipMcp = this.dist(tip, mcp);
    const dPipMcp = this.dist(pip, mcp);

    return dWristTip > dWristPip && dTipMcp > dPipMcp * 1.2;
  }

  private static isThumbExtended(landmarks: Landmark[]): boolean {
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const thumbMcp = landmarks[2];
    const indexMcp = landmarks[5];

    const dTipWrist = this.dist(thumbTip, wrist);
    const dMcpWrist = this.dist(thumbMcp, wrist);

    // Also distance to index base
    const dTipIndexMcp = this.dist(thumbTip, indexMcp);

    return dTipWrist > dMcpWrist * 1.1 && dTipIndexMcp > 0.1;
  }

  /**
   * Thumb-tip to index-tip distance normalised by hand size. Small values mean
   * the fingers are pinched together. Used for the PINCH gesture, which the
   * curl/direction model of fingerpose cannot express.
   */
  public static pinchRatio(landmarks: Landmark[]): number {
    if (!landmarks || landmarks.length < 21) return 1;
    const pinchDist = this.dist(landmarks[4], landmarks[8]);
    const handSpan = this.dist(landmarks[0], landmarks[5]) || 1;
    return pinchDist / handSpan;
  }

  /** True when the four long fingers are curled towards the palm. */
  public static longFingersCurled(landmarks: Landmark[]): boolean {
    if (!landmarks || landmarks.length < 21) return false;
    return (
      !this.isFingerExtended(landmarks, 9, 10, 11, 12) &&
      !this.isFingerExtended(landmarks, 13, 14, 15, 16) &&
      !this.isFingerExtended(landmarks, 17, 18, 19, 20)
    );
  }

  private static dist(p1: Landmark, p2: Landmark): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
