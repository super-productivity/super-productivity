import { PluginBeforeCloseHandler } from '@super-productivity/plugin-api';

export const PLUGIN_BEFORE_CLOSE_ID = 'PLUGIN_BEFORE_CLOSE_ID';
export const PLUGIN_BEFORE_CLOSE_TIMEOUT_MS = 15_000;

interface CloseRegistration {
  callback: PluginBeforeCloseHandler;
  abort?: () => void;
}

/** Финализаторы выполняются после подтверждения выхода обычными участниками. */
export class BeforeCloseCoordinator {
  private readonly _callbacks = new Map<string, CloseRegistration>();
  private _pending = new Set<string>();
  private _requested = false;
  private _running = false;
  private _scheduled = false;
  private _generation = 0;
  private _cancelRun?: () => void;

  constructor(
    private readonly _port: {
      schedule(id: string): void;
      unschedule(id: string): void;
      done(id: string): void;
    },
    private readonly _reportError: () => void = () => {},
  ) {}

  register(key: string, callback: PluginBeforeCloseHandler | null): void {
    this._callbacks.get(key)?.abort?.();
    this._callbacks.delete(key);
    if (callback) this._callbacks.set(key, { callback });
    if (this._callbacks.size && !this._scheduled) {
      this._scheduled = true;
      this._port.schedule(PLUGIN_BEFORE_CLOSE_ID);
    } else if (!this._callbacks.size && this._scheduled && !this._running) {
      this._scheduled = false;
      if (this._requested) {
        this._requested = false;
        this._port.done(PLUGIN_BEFORE_CLOSE_ID);
      } else {
        this._port.unschedule(PLUGIN_BEFORE_CLOSE_ID);
      }
    }
  }

  unregisterPlugin(pluginId: string): void {
    for (const key of this._callbacks.keys()) {
      if (key.startsWith(`${pluginId}\0`)) this.register(key, null);
    }
  }

  request(ids: string[], notify: (ordinaryIds: string[]) => void): void {
    const ordinaryIds = ids.filter((id) => id !== PLUGIN_BEFORE_CLOSE_ID);
    this._pending = new Set(ordinaryIds);
    this._requested = ids.includes(PLUGIN_BEFORE_CLOSE_ID);
    // Сначала сохраняем IDs: обычный участник может подтвердить выход синхронно.
    if (ordinaryIds.length) notify(ordinaryIds);
    this._maybeRun();
  }

  done(id: string): void {
    this._port.done(id);
    this._pending.delete(id);
    this._maybeRun();
  }

  unscheduled(id: string): void {
    this._pending.delete(id);
    this._maybeRun();
  }

  cancelCloseAttempt(): void {
    this._requested = false;
    this._pending.clear();
    this._generation++;
    this._cancelRun?.();
    this._cancelRun = undefined;
    this._running = false;
  }

  private _maybeRun(): void {
    if (!this._requested || this._pending.size || this._running) return;
    this._running = true;
    const generation = this._generation;
    const deadlineAt = Date.now() + PLUGIN_BEFORE_CLOSE_TIMEOUT_MS;
    const controllers: AbortController[] = [];
    const abortAll = (): void => {
      controllers.forEach((controller) => controller.abort());
    };
    this._cancelRun = abortAll;
    const timer = setTimeout(abortAll, PLUGIN_BEFORE_CLOSE_TIMEOUT_MS);
    const callbacks = [...this._callbacks.values()].map((entry) => {
      const controller = new AbortController();
      controllers.push(controller);
      entry.abort = () => controller.abort();
      const aborted = new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      const operation = Promise.resolve().then(() => {
        if (!controller.signal.aborted && Date.now() < deadlineAt) {
          return entry.callback({ deadlineAt, signal: controller.signal });
        }
        controller.abort();
      });
      return Promise.race([operation, aborted]).catch(this._reportError);
    });
    void Promise.all(callbacks).finally(() => {
      clearTimeout(timer);
      controllers.forEach((controller) => controller.abort());
      if (generation !== this._generation) return;
      this._cancelRun = undefined;
      this._running = false;
      this._requested = false;
      this._scheduled = false;
      this._port.done(PLUGIN_BEFORE_CLOSE_ID);
    });
  }
}
