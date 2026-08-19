import { VISION } from '../config/Constants';

export type CameraState = 'IDLE' | 'REQUESTING' | 'READY' | 'DENIED' | 'ERROR';

/**
 * Owns THIS laptop's single webcam stream.
 *
 * One device = one camera = one player. The stream never leaves the browser:
 * it is consumed locally by HandTracker and FaceDetector and rendered into the
 * local picture-in-picture preview. Nothing here ever touches the network.
 */
export class CameraManager {
  private static instance: CameraManager;

  public state: CameraState = 'IDLE';
  public lastError: string | null = null;

  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  private constructor() {}

  public static getInstance(): CameraManager {
    if (!CameraManager.instance) CameraManager.instance = new CameraManager();
    return CameraManager.instance;
  }

  public get videoElement(): HTMLVideoElement | null {
    return this.video ?? (this.video = document.getElementById('webcam-video') as HTMLVideoElement | null);
  }

  public get isReady(): boolean {
    const v = this.videoElement;
    return this.state === 'READY' && !!v && v.readyState >= 2 && v.videoWidth > 0;
  }

  public get resolution(): { width: number; height: number } {
    const v = this.videoElement;
    return {
      width: v?.videoWidth || VISION.videoWidth,
      height: v?.videoHeight || VISION.videoHeight
    };
  }

  /** Asks for camera permission and starts the stream. Safe to call twice. */
  public async enable(): Promise<boolean> {
    if (this.state === 'READY' && this.stream?.active) return true;

    const video = this.videoElement;
    if (!video) {
      this.fail('CAMERA ELEMENT MISSING');
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail('THIS BROWSER HAS NO CAMERA API (NEEDS HTTPS)');
      return false;
    }

    this.state = 'REQUESTING';
    this.lastError = null;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: VISION.videoWidth },
          height: { ideal: VISION.videoHeight },
          facingMode: 'user'
        },
        audio: false
      });

      video.srcObject = this.stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) return resolve();
        video.onloadedmetadata = () => resolve();
        window.setTimeout(resolve, 4000);
      });

      await video.play().catch(() => undefined);

      this.state = 'READY';
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.state = 'DENIED';
        this.lastError = 'CAMERA PERMISSION DENIED';
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        this.fail('NO WEBCAM FOUND ON THIS DEVICE');
      } else {
        this.fail(`CAMERA ERROR: ${(err as Error).message}`);
      }
      return false;
    }
  }

  public disable(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.state = 'IDLE';
  }

  private fail(message: string): void {
    this.state = 'ERROR';
    this.lastError = message;
    console.warn(message);
  }
}
