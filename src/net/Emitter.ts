type Handler<T> = (payload: T) => void;

/** Minimal typed event emitter - no dependency, no Phaser coupling. */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Array<Handler<Events[K]>> } = {};

  public on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    (this.handlers[event] ??= []).push(handler);
    return () => this.off(event, handler);
  }

  public off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const list = this.handlers[event];
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  public emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.handlers[event];
    if (!list) return;
    for (const handler of [...list]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`Emitter handler for "${String(event)}" threw:`, err);
      }
    }
  }

  /** Drop every listener for one event, or for all events when omitted. */
  public clear<K extends keyof Events>(event?: K): void {
    if (event) delete this.handlers[event];
    else this.handlers = {};
  }
}
