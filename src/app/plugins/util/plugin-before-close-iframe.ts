import {
  PluginBeforeCloseHandler,
  PluginIframeMessageType,
} from '@super-productivity/plugin-api';

interface BeforeCloseFrameConfig {
  bridgeToken: string;
  bridgeGeneration: number;
  isAlive: () => boolean;
  register: (handler: PluginBeforeCloseHandler | null) => boolean;
}

/** Ожидаемый callback; обычные API-сообщения продолжают обрабатываться параллельно. */
export class PluginBeforeCloseIframe {
  private _requestId = 0;
  private readonly _pending = new Set<() => void>();
  private _disposed = false;

  constructor(private readonly _config: BeforeCloseFrameConfig) {}

  register(source: Window, handler: unknown): boolean {
    if (handler !== null && handler !== 'IFRAME_HANDLER') {
      throw new Error('Iframe onBeforeAppClose requires IFRAME_HANDLER or null');
    }
    if (this._disposed || !this._config.isAlive()) return false;
    this._cancelPending();
    return this._config.register(
      handler === null
        ? null
        : (context) =>
            new Promise<void>((resolve, reject) => {
              if (
                !this._config.isAlive() ||
                context.signal.aborted ||
                context.deadlineAt <= Date.now()
              ) {
                resolve();
                return;
              }
              const requestId = ++this._requestId;
              const finish = (error?: string): void => {
                clearTimeout(timer);
                window.removeEventListener('message', respond);
                context.signal.removeEventListener('abort', abort);
                this._pending.delete(abort);
                if (error) reject(new Error(error));
                else resolve();
              };
              const abort = (): void => {
                source.postMessage(
                  { type: PluginIframeMessageType.BEFORE_CLOSE_ABORT, requestId },
                  '*',
                );
                finish();
              };
              const respond = (event: MessageEvent): void => {
                const data = event.data;
                if (
                  event.source !== source ||
                  !this._config.isAlive() ||
                  data?.bridgeToken !== this._config.bridgeToken ||
                  data?.bridgeGeneration !== this._config.bridgeGeneration ||
                  data?.type !== PluginIframeMessageType.BEFORE_CLOSE_RESULT ||
                  data?.requestId !== requestId
                )
                  return;
                finish(typeof data.error === 'string' ? data.error : undefined);
              };
              const timer = setTimeout(
                abort,
                Math.max(0, context.deadlineAt - Date.now()),
              );
              this._pending.add(abort);
              context.signal.addEventListener('abort', abort, { once: true });
              window.addEventListener('message', respond);
              source.postMessage(
                {
                  type: PluginIframeMessageType.BEFORE_CLOSE,
                  requestId,
                  deadlineAt: context.deadlineAt,
                },
                '*',
              );
            }),
    );
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelPending();
    this._config.register(null);
  }

  private _cancelPending(): void {
    [...this._pending].forEach((abort) => abort());
  }
}
