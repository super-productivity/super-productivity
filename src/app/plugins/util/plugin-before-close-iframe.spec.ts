import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import {
  PluginBeforeCloseHandler,
  PluginIframeMessageType,
} from '@super-productivity/plugin-api';
import { PluginBeforeCloseIframe } from './plugin-before-close-iframe';

describe('PluginBeforeCloseIframe', () => {
  let callback: PluginBeforeCloseHandler | null;
  let alive: boolean;
  let bridge: PluginBeforeCloseIframe;
  let source: Window;
  let postMessage: jasmine.Spy;

  beforeEach(() => {
    callback = null;
    alive = true;
    postMessage = jasmine.createSpy('iframe postMessage');
    source = { postMessage } as unknown as Window;
    bridge = new PluginBeforeCloseIframe({
      bridgeToken: 'token',
      bridgeGeneration: 4,
      isAlive: () => alive,
      register: (handler) => {
        callback = handler;
        return true;
      },
    });
  });
  afterEach(() => bridge.dispose());

  const respond = (frameSource: Window, data: Record<string, unknown>): void => {
    const event = new MessageEvent('message', { data });
    Object.defineProperty(event, 'source', { value: frameSource });
    window.dispatchEvent(event);
  };

  it('ignores a response from another source, token or generation', fakeAsync(() => {
    bridge.register(source, 'IFRAME_HANDLER');
    const controller = new AbortController();
    let settled = false;
    void Promise.resolve(
      callback!({ deadlineAt: Date.now() + 15_000, signal: controller.signal }),
    ).then(() => (settled = true));
    const requestId = postMessage.calls.mostRecent().args[0].requestId;
    const data = {
      type: PluginIframeMessageType.BEFORE_CLOSE_RESULT,
      requestId,
      bridgeToken: 'token',
      bridgeGeneration: 4,
    };
    respond({} as Window, data);
    respond(source, { ...data, bridgeToken: 'wrong' });
    respond(source, { ...data, bridgeGeneration: 3 });
    flushMicrotasks();
    expect(settled).toBeFalse();
    respond(source, data);
    flushMicrotasks();
    expect(settled).toBeTrue();
  }));

  it('installs its response listener before sending the callback request', async () => {
    bridge.register(source, 'IFRAME_HANDLER');
    postMessage.and.callFake((data: Record<string, unknown>) => {
      respond(source, {
        type: PluginIframeMessageType.BEFORE_CLOSE_RESULT,
        requestId: data.requestId,
        bridgeToken: 'token',
        bridgeGeneration: 4,
      });
    });
    await callback!({
      deadlineAt: Date.now() + 15_000,
      signal: new AbortController().signal,
    });
  });

  it('aborts a dead iframe callback at the absolute deadline', fakeAsync(() => {
    bridge.register(source, 'IFRAME_HANDLER');
    let settled = false;
    void Promise.resolve(
      callback!({
        deadlineAt: Date.now() + 15_000,
        signal: new AbortController().signal,
      }),
    ).then(() => (settled = true));
    tick(14_999);
    expect(settled).toBeFalse();
    tick(1);
    expect(settled).toBeTrue();
    expect(postMessage.calls.mostRecent().args[0].type).toBe(
      PluginIframeMessageType.BEFORE_CLOSE_ABORT,
    );
  }));

  it('cancels pending callbacks and removes its registration on iframe destruction', fakeAsync(() => {
    bridge.register(source, 'IFRAME_HANDLER');
    let settled = false;
    void Promise.resolve(
      callback!({
        deadlineAt: Date.now() + 15_000,
        signal: new AbortController().signal,
      }),
    ).then(() => (settled = true));
    bridge.dispose();
    flushMicrotasks();
    expect(settled).toBeTrue();
    expect(callback).toBeNull();
    expect(bridge.register(source, 'IFRAME_HANDLER')).toBeFalse();
  }));

  it('does not accept an acknowledgement after the iframe generation is revoked', fakeAsync(() => {
    bridge.register(source, 'IFRAME_HANDLER');
    const controller = new AbortController();
    let settled = false;
    void Promise.resolve(
      callback!({ deadlineAt: Date.now() + 15_000, signal: controller.signal }),
    ).then(() => (settled = true));
    const requestId = postMessage.calls.mostRecent().args[0].requestId;
    alive = false;
    respond(source, {
      type: PluginIframeMessageType.BEFORE_CLOSE_RESULT,
      requestId,
      bridgeToken: 'token',
      bridgeGeneration: 4,
    });
    flushMicrotasks();
    expect(settled).toBeFalse();
    controller.abort();
    flushMicrotasks();
    expect(settled).toBeTrue();
  }));
});
