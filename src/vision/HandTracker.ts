import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import * as handPoseDetection from '@tensorflow-models/hand-pose-detection';
import { VISION } from '../config/Constants';
import { CameraManager } from './CameraManager';
import { HANDS_SOLUTION_PATH } from '../shims/mediapipe-hands';

/** Landmark tuple in the format fingerpose expects: [x, y, z] pixel space. */
export type Landmark3D = [number, number, number];

export interface HandFrame {
  /** Pixel-space landmarks (mirrored, matching the on-screen preview). */
  landmarksPx: Landmark3D[];
  /** Same landmarks normalised to 0..1 of the video frame. */
  landmarksNorm: Array<{ x: number; y: number; z: number }>;
  /** Normalised wrist position, used for movement. */
  wrist: { x: number; y: number };
  score: number;
  handedness: string;
}

/**
 * ONE CAMERA -> ONE HAND -> ONE PLAYER.
 *
 * This is the piece adapted from https://github.com/chaitanya-chafale/Hand-Gesture-Gaming
 * which runs TensorFlow.js + MediaPipe hand landmarks on a throttled interval
 * and hands the 21 keypoints to fingerpose. The critical difference: this tracker
 * is hard-limited to a SINGLE hand, because the second player is on another
 * laptop with their own camera. There is no "left hand = P1, right hand = P2".
 */
export class HandTracker {
  private detector: handPoseDetection.HandDetector | null = null;
  private camera = CameraManager.getInstance();

  private running = false;
  private lastRunAt = 0;
  private busy = false;
  private debug = false;

  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private callback: ((frame: HandFrame | null) => void) | null = null;

  public modelReady = false;
  public lastError: string | null = null;

  /** Loads the MediaPipe Hands landmark model through TensorFlow.js. */
  public async initialize(onProgress?: (msg: string, pct: number) => void): Promise<boolean> {
    if (this.modelReady) return true;

    try {
      onProgress?.('LOADING TENSORFLOW BACKEND...', 25);
      await tf.ready();
      try {
        await tf.setBackend('webgl');
      } catch {
        console.warn('WebGL backend unavailable, using default backend');
      }

      onProgress?.('LOADING MEDIAPIPE HAND MODEL...', 60);
      this.detector = await this.createDetector();
      this.modelReady = true;
      onProgress?.('HAND ENGINE READY', 100);
      return true;
    } catch (err) {
      this.lastError = `HAND MODEL FAILED: ${(err as Error).message}`;
      console.error(this.lastError, err);
      onProgress?.('HAND MODEL UNAVAILABLE - KEYBOARD FALLBACK', 100);
      return false;
    }
  }

  private async createDetector(): Promise<handPoseDetection.HandDetector> {
    const model = handPoseDetection.SupportedModels.MediaPipeHands;

    try {
      return await handPoseDetection.createDetector(model, {
        runtime: 'mediapipe',
        solutionPath: HANDS_SOLUTION_PATH,
        modelType: 'full',
        maxHands: 1 // ONE DEVICE = ONE PLAYER = ONE HAND
      });
    } catch (err) {
      console.warn('MediaPipe runtime unavailable, falling back to the tfjs runtime', err);
      return await handPoseDetection.createDetector(model, {
        runtime: 'tfjs',
        modelType: 'full',
        maxHands: 1
      });
    }
  }

  public start(callback: (frame: HandFrame | null) => void): void {
    this.callback = callback;
    if (this.running) return;
    this.running = true;
    this.bindOverlay();
    void this.loop();
  }

  public stop(): void {
    this.running = false;
  }

  public setDebug(enabled: boolean): void {
    this.debug = enabled;
    this.bindOverlay();
    if (!enabled && this.overlayCtx && this.overlay) {
      this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
  }

  public isDebug(): boolean {
    return this.debug;
  }

  private bindOverlay(): void {
    if (!this.overlay) {
      this.overlay = document.getElementById('hand-overlay') as HTMLCanvasElement | null;
      this.overlayCtx = this.overlay?.getContext('2d') ?? null;
    }
  }

  private async loop(): Promise<void> {
    if (!this.running) return;

    const now = performance.now();
    if (!this.busy && now - this.lastRunAt >= VISION.handIntervalMs) {
      this.lastRunAt = now;
      this.busy = true;
      try {
        this.callback?.(await this.detectOnce());
      } catch (err) {
        console.error('hand detection frame failed', err);
        this.callback?.(null);
      } finally {
        this.busy = false;
      }
    }

    requestAnimationFrame(() => void this.loop());
  }

  private async detectOnce(): Promise<HandFrame | null> {
    const video = this.camera.videoElement;
    if (!this.detector || !video || !this.camera.isReady) {
      this.clearOverlay();
      return null;
    }

    const hands = await this.detector.estimateHands(video, { flipHorizontal: true });
    if (hands.length === 0) {
      this.clearOverlay();
      return null;
    }

    const hand = hands[0];
    const { width, height } = this.camera.resolution;

    const landmarksPx: Landmark3D[] = hand.keypoints.map((kp, i) => [
      kp.x,
      kp.y,
      hand.keypoints3D?.[i]?.z ?? 0
    ]);

    const landmarksNorm = landmarksPx.map(([x, y, z]) => ({
      x: x / width,
      y: y / height,
      z
    }));

    this.draw(landmarksNorm);

    return {
      landmarksPx,
      landmarksNorm,
      wrist: { x: landmarksNorm[0].x, y: landmarksNorm[0].y },
      score: hand.score ?? 0,
      handedness: hand.handedness ?? 'Unknown'
    };
  }

  // ---------------------------------------------------------------------------
  // Landmark overlay - the skeleton drawing from the reference project's
  // utilities.js, redrawn onto the local preview canvas.
  // ---------------------------------------------------------------------------

  private static readonly CONNECTIONS: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17]
  ];

  private clearOverlay(): void {
    if (!this.overlayCtx || !this.overlay) return;
    this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private draw(landmarks: Array<{ x: number; y: number }>): void {
    this.bindOverlay();
    if (!this.overlayCtx || !this.overlay) return;

    const canvas = this.overlay;
    const ctx = this.overlayCtx;

    const cssWidth = canvas.clientWidth || 200;
    const cssHeight = canvas.clientHeight || 150;
    if (canvas.width !== cssWidth || canvas.height !== cssHeight) {
      canvas.width = cssWidth;
      canvas.height = cssHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const px = (n: number) => n * canvas.width;
    const py = (n: number) => n * canvas.height;

    ctx.strokeStyle = '#00fff9';
    ctx.lineWidth = 2;
    for (const [a, b] of HandTracker.CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      if (!p1 || !p2) continue;
      ctx.beginPath();
      ctx.moveTo(px(p1.x), py(p1.y));
      ctx.lineTo(px(p2.x), py(p2.y));
      ctx.stroke();
    }

    ctx.fillStyle = '#ff2a6d';
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(px(point.x), py(point.y), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
