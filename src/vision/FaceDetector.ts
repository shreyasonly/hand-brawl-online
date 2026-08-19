import * as faceDetection from '@tensorflow-models/face-detection';
import { VISION } from '../config/Constants';
import { CameraManager } from './CameraManager';

export interface FaceFrame {
  present: boolean;
  score: number;
  box: { x: number; y: number; width: number; height: number } | null;
  /**
   * Local-only face signature: normalised geometry between the six MediaPipe
   * face keypoints. It is used to recognise the profile of the person sitting
   * at THIS laptop and nothing else. It is never broadcast, never uploaded and
   * never used to decide who is Player 1 or Player 2 - the lobby does that.
   */
  signature: number[] | null;
}

const PROFILE_STORAGE_KEY = 'hand-brawl.local-face-profile';

/**
 * Real local face detection (MediaPipe Face Detector via TensorFlow.js).
 *
 * Runs at a low frame rate next to the hand tracker - it only has to answer
 * "is a player sitting in front of this laptop?" for the FACE DETECTED readout.
 */
export class FaceDetector {
  private detector: faceDetection.FaceDetector | null = null;
  private camera = CameraManager.getInstance();

  private running = false;
  private busy = false;
  private lastRunAt = 0;
  private missStreak = 0;

  private latest: FaceFrame = { present: false, score: 0, box: null, signature: null };
  private callback: ((frame: FaceFrame) => void) | null = null;

  public modelReady = false;
  public lastError: string | null = null;

  public async initialize(onProgress?: (msg: string, pct: number) => void): Promise<boolean> {
    if (this.modelReady) return true;

    try {
      onProgress?.('LOADING FACE MODEL...', 80);
      this.detector = await this.createDetector();
      this.modelReady = true;
      return true;
    } catch (err) {
      this.lastError = `FACE MODEL FAILED: ${(err as Error).message}`;
      console.warn(this.lastError, err);
      return false;
    }
  }

  private async createDetector(): Promise<faceDetection.FaceDetector> {
    const model = faceDetection.SupportedModels.MediaPipeFaceDetector;

    try {
      return await faceDetection.createDetector(model, {
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection',
        modelType: 'short',
        maxFaces: 1
      });
    } catch (err) {
      console.warn('MediaPipe face runtime unavailable, falling back to tfjs', err);
      return await faceDetection.createDetector(model, {
        runtime: 'tfjs',
        modelType: 'short',
        maxFaces: 1
      });
    }
  }

  public start(callback?: (frame: FaceFrame) => void): void {
    this.callback = callback ?? null;
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  public stop(): void {
    this.running = false;
  }

  public get current(): FaceFrame {
    return this.latest;
  }

  public isFacePresent(): boolean {
    return this.latest.present;
  }

  private async loop(): Promise<void> {
    if (!this.running) return;

    const now = performance.now();
    if (!this.busy && now - this.lastRunAt >= VISION.faceIntervalMs) {
      this.lastRunAt = now;
      this.busy = true;
      try {
        await this.detectOnce();
      } catch (err) {
        console.error('face detection frame failed', err);
      } finally {
        this.busy = false;
      }
    }

    requestAnimationFrame(() => void this.loop());
  }

  private async detectOnce(): Promise<void> {
    const video = this.camera.videoElement;
    if (!this.detector || !video || !this.camera.isReady) {
      this.publish({ present: false, score: 0, box: null, signature: null });
      return;
    }

    const faces = await this.detector.estimateFaces(video, { flipHorizontal: true });

    if (faces.length === 0) {
      // Small hysteresis so a single dropped frame does not flicker the readout.
      this.missStreak++;
      if (this.missStreak >= 2) {
        this.publish({ present: false, score: 0, box: null, signature: null });
      }
      return;
    }

    this.missStreak = 0;
    const face = faces[0];
    const { width, height } = this.camera.resolution;

    this.publish({
      present: true,
      score: (face as unknown as { score?: number }).score ?? 1,
      box: {
        x: face.box.xMin / width,
        y: face.box.yMin / height,
        width: face.box.width / width,
        height: face.box.height / height
      },
      signature: this.buildSignature(face)
    });
  }

  /**
   * Normalised distances between the detector's keypoints (eyes, ears, nose,
   * mouth), scaled by inter-ocular distance so it is roughly invariant to how
   * far the player sits from the laptop. Stays on this device.
   */
  private buildSignature(face: faceDetection.Face): number[] | null {
    const kp = face.keypoints;
    if (!kp || kp.length < 6) return null;

    const [rightEye, leftEye] = [kp[0], kp[1]];
    const scale = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y) || 1;

    const signature: number[] = [];
    for (let i = 2; i < Math.min(kp.length, 6); i++) {
      signature.push(
        Number(((kp[i].x - rightEye.x) / scale).toFixed(3)),
        Number(((kp[i].y - rightEye.y) / scale).toFixed(3))
      );
    }
    return signature;
  }

  private publish(frame: FaceFrame): void {
    this.latest = frame;
    this.callback?.(frame);
  }

  // ---------------------------------------------------------------------------
  // Optional local profile - purely cosmetic ("WELCOME BACK"), never networked.
  // ---------------------------------------------------------------------------

  public saveLocalProfile(name: string): boolean {
    const signature = this.latest.signature;
    if (!signature) return false;
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ name, signature }));
      return true;
    } catch {
      return false;
    }
  }

  /** Returns the stored profile name when the current face looks like a match. */
  public matchLocalProfile(tolerance = 0.35): string | null {
    const signature = this.latest.signature;
    if (!signature) return null;

    try {
      const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as { name: string; signature: number[] };
      if (!stored?.signature || stored.signature.length !== signature.length) return null;

      let total = 0;
      for (let i = 0; i < signature.length; i++) {
        total += (signature[i] - stored.signature[i]) ** 2;
      }
      const distance = Math.sqrt(total / signature.length);
      return distance <= tolerance ? stored.name : null;
    } catch {
      return null;
    }
  }
}
