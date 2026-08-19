import { VisionStatus } from '../vision/VisionPipeline';
import { ConnectionStatus } from '../net/RoomSession';

/**
 * Thin wrapper around the HTML chrome that sits on top of the Phaser canvas:
 * the local camera preview, the realtime connection badge and the room-code
 * modal. Keeping this in the DOM means the webcam element and the code input
 * behave like normal browser widgets (focus, paste, mobile keyboards).
 */
export class DomUI {
  private static instance: DomUI;

  private pip = document.getElementById('camera-pip');
  private faceStatus = document.getElementById('face-status');
  private handStatus = document.getElementById('hand-status');
  private gestureStatus = document.getElementById('gesture-status');
  private netBadge = document.getElementById('net-badge');

  private modalRoot = document.getElementById('modal-root');
  private modalTitle = document.getElementById('modal-title');
  private modalSubtitle = document.getElementById('modal-subtitle');
  private modalError = document.getElementById('modal-error');
  private codeInput = document.getElementById('room-code-input') as HTMLInputElement | null;
  private confirmBtn = document.getElementById('modal-confirm') as HTMLButtonElement | null;
  private cancelBtn = document.getElementById('modal-cancel') as HTMLButtonElement | null;

  private modalResolver: ((value: string | null) => void) | null = null;

  private constructor() {
    this.confirmBtn?.addEventListener('click', () => this.submitModal());
    this.cancelBtn?.addEventListener('click', () => this.closeModal(null));

    this.codeInput?.addEventListener('keydown', (e) => {
      // Stop Phaser's global key handlers from reacting while typing a code.
      e.stopPropagation();
      if (e.key === 'Enter') this.submitModal();
      if (e.key === 'Escape') this.closeModal(null);
    });

    this.codeInput?.addEventListener('input', () => {
      if (!this.codeInput) return;
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      this.setModalError('');
    });
  }

  public static getInstance(): DomUI {
    if (!DomUI.instance) DomUI.instance = new DomUI();
    return DomUI.instance;
  }

  // ---------------------------------------------------------------------------
  // Loading screen
  // ---------------------------------------------------------------------------

  public setLoading(message: string, percent: number): void {
    const fill = document.getElementById('loading-bar-fill');
    const text = document.getElementById('loading-text');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (text) text.textContent = message;
  }

  public hideLoading(): void {
    const screen = document.getElementById('loading-screen');
    if (!screen) return;
    screen.style.opacity = '0';
    window.setTimeout(() => screen.classList.add('hidden'), 500);
  }

  // ---------------------------------------------------------------------------
  // Local camera preview
  // ---------------------------------------------------------------------------

  public showCameraPip(visible: boolean): void {
    this.pip?.classList.toggle('hidden', !visible);
  }

  /**
   * Compact mode for the fight: a small strip pinned top-right under the P2
   * HUD, so the preview never covers the arena floor or the fighters.
   */
  public setCameraPipCompact(compact: boolean): void {
    this.pip?.classList.toggle('compact', compact);
  }

  public updateVisionStatus(status: VisionStatus): void {
    this.applyStatusLine(
      this.faceStatus,
      status.faceDetected ? 'FACE DETECTED ✓' : 'FACE NOT DETECTED',
      status.faceDetected
    );
    this.applyStatusLine(
      this.handStatus,
      status.handDetected ? 'HAND DETECTED ✓' : 'HAND NOT DETECTED',
      status.handDetected
    );

    if (this.gestureStatus) {
      const label = status.gesture === 'NONE' ? 'GESTURE ---' : `GESTURE ${status.gesture}`;
      this.gestureStatus.textContent = label;
      this.gestureStatus.className = status.gesture === 'NONE' ? 'status-idle' : 'status-ok';
    }
  }

  private applyStatusLine(el: HTMLElement | null, text: string, ok: boolean): void {
    if (!el) return;
    el.textContent = text;
    el.className = ok ? 'status-ok' : 'status-bad';
  }

  // ---------------------------------------------------------------------------
  // Connection badge
  // ---------------------------------------------------------------------------

  public updateNetBadge(status: ConnectionStatus, roomCode: string | null, slot: string | null): void {
    if (!this.netBadge) return;

    if (status === 'OFFLINE') {
      this.netBadge.classList.add('hidden');
      return;
    }

    this.netBadge.classList.remove('hidden');
    const who = slot ? slot.toUpperCase() : '--';
    const room = roomCode ? ` / ${roomCode}` : '';
    this.netBadge.textContent = `${status}${room} / YOU ARE ${who}`;

    const colour =
      status === 'CONNECTED' ? '#4dff9f' : status === 'ERROR' ? '#ff5f7a' : '#ffb703';
    this.netBadge.style.color = colour;
    this.netBadge.style.borderColor = colour;
  }

  // ---------------------------------------------------------------------------
  // Room code modal
  // ---------------------------------------------------------------------------

  /** Resolves with the typed code, or null when the player cancels. */
  public promptRoomCode(): Promise<string | null> {
    if (!this.modalRoot || !this.codeInput) return Promise.resolve(null);

    if (this.modalTitle) this.modalTitle.textContent = 'JOIN LOBBY';
    if (this.modalSubtitle) this.modalSubtitle.textContent = 'ENTER THE 6-CHARACTER ROOM CODE';
    if (this.confirmBtn) {
      this.confirmBtn.textContent = 'JOIN';
      this.confirmBtn.disabled = false;
    }

    this.setModalError('');
    this.codeInput.value = '';
    this.modalRoot.classList.remove('hidden');
    window.setTimeout(() => this.codeInput?.focus(), 30);

    return new Promise<string | null>((resolve) => {
      this.modalResolver = resolve;
    });
  }

  public setModalBusy(busy: boolean, message?: string): void {
    if (this.confirmBtn) {
      this.confirmBtn.disabled = busy;
      this.confirmBtn.textContent = busy ? 'CONNECTING...' : 'JOIN';
    }
    if (message) this.setModalError(message);
  }

  public setModalError(message: string): void {
    if (this.modalError) this.modalError.textContent = message;
  }

  public closeModal(value: string | null): void {
    this.modalRoot?.classList.add('hidden');
    const resolver = this.modalResolver;
    this.modalResolver = null;
    resolver?.(value);
  }

  private submitModal(): void {
    const code = (this.codeInput?.value ?? '').trim().toUpperCase();
    if (code.length !== 6) {
      this.setModalError('CODE MUST BE 6 CHARACTERS');
      return;
    }
    const resolver = this.modalResolver;
    this.modalResolver = null;
    resolver?.(code);
  }
}
