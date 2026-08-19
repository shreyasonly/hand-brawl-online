import { CameraManager, CameraState } from './CameraManager';
import { FaceDetector } from './FaceDetector';
import { HandTracker, HandFrame } from './HandTracker';
import { GestureRecognizer } from '../gestures/GestureRecognizer';
import { GestureSmoother, GestureIntent, EMPTY_INTENT } from '../gestures/GestureSmoother';
import { Gesture } from '../gestures/GestureConfig';

export interface VisionStatus {
  cameraState: CameraState;
  cameraEnabled: boolean;
  faceDetected: boolean;
  handDetected: boolean;
  gesture: Gesture;
  confidence: number;
  /** Local-only recognised profile name, if the player saved one. */
  profileName: string | null;
  error: string | null;
}

const HAND_PRESENCE_GRACE_MS = 500;

/**
 * The whole computer-vision stack for THIS laptop, in one place and completely
 * independent of Phaser:
 *
 *   webcam -> HandTracker (TF.js + MediaPipe Hands)
 *          -> GestureRecognizer (fingerpose)
 *          -> GestureSmoother
 *          -> GestureIntent  ... which is all the game ever sees.
 *
 * The parallel FaceDetector only answers "is somebody sitting here?".
 * No pixels, landmarks or face data ever leave this object.
 */
export class VisionPipeline {
  private static instance: VisionPipeline;

  public readonly camera = CameraManager.getInstance();
  public readonly hands = new HandTracker();
  public readonly face = new FaceDetector();

  private recognizer = new GestureRecognizer();
  private smoother = new GestureSmoother();

  private lastHandAt = 0;
  private latestIntent: GestureIntent = { ...EMPTY_INTENT };
  private listeners: Array<(intent: GestureIntent) => void> = [];

  private modelsReady = false;
  private started = false;

  private constructor() {}

  public static getInstance(): VisionPipeline {
    if (!VisionPipeline.instance) VisionPipeline.instance = new VisionPipeline();
    return VisionPipeline.instance;
  }

  /** Loads the TF.js models. Safe to call before the camera is enabled. */
  public async initModels(onProgress?: (msg: string, pct: number) => void): Promise<boolean> {
    if (this.modelsReady) return true;
    const handOk = await this.hands.initialize(onProgress);
    await this.face.initialize(onProgress);
    this.modelsReady = handOk;
    return handOk;
  }

  /** Prompts for webcam permission and starts both detectors. */
  public async enableCamera(): Promise<boolean> {
    const ok = await this.camera.enable();
    if (!ok) return false;
    await this.initModels();
    this.start();
    return true;
  }

  public start(): void {
    if (this.started) return;
    this.started = true;

    this.hands.start((frame) => this.onHandFrame(frame));
    this.face.start();
  }

  public stop(): void {
    this.started = false;
    this.hands.stop();
    this.face.stop();
  }

  public shutdown(): void {
    this.stop();
    this.camera.disable();
    this.latestIntent = { ...EMPTY_INTENT };
  }

  public onIntent(listener: (intent: GestureIntent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  public get intent(): GestureIntent {
    return this.latestIntent;
  }

  public get status(): VisionStatus {
    const handDetected = performance.now() - this.lastHandAt < HAND_PRESENCE_GRACE_MS;
    return {
      cameraState: this.camera.state,
      cameraEnabled: this.camera.state === 'READY',
      faceDetected: this.face.isFacePresent(),
      handDetected,
      gesture: this.latestIntent.gesture,
      confidence: this.latestIntent.confidence,
      profileName: this.face.matchLocalProfile(),
      error: this.camera.lastError ?? this.hands.lastError ?? this.face.lastError
    };
  }

  public setDebug(enabled: boolean): void {
    this.hands.setDebug(enabled);
  }

  public isDebug(): boolean {
    return this.hands.isDebug();
  }

  /** Re-centres the "standing still" hand position on the current hand. */
  public calibrate(): void {
    this.smoother.calibrateCenter();
  }

  public resetGestureState(): void {
    this.smoother.reset();
  }

  private onHandFrame(frame: HandFrame | null): void {
    const now = performance.now();
    if (frame) this.lastHandAt = now;

    const recognized = this.recognizer.recognize(frame);
    this.latestIntent = this.smoother.process(frame, recognized, now);

    for (const listener of [...this.listeners]) {
      try {
        listener(this.latestIntent);
      } catch (err) {
        console.error('vision intent listener threw', err);
      }
    }
  }
}
