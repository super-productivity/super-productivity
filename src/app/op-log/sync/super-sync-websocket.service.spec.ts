import { TestBed } from '@angular/core/testing';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { SuperSyncWebSocketService } from './super-sync-websocket.service';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = jasmine.createSpy('send');
  close = jasmine.createSpy('close').and.callFake((_code?: number, _reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.({ data: payload } as MessageEvent);
  }

  emitClose(code = 1006, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

describe('SuperSyncWebSocketService', () => {
  let service: SuperSyncWebSocketService;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    jasmine.clock().install();
    MockWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;

    mockClientIdProvider = {
      loadClientId: jasmine
        .createSpy('loadClientId')
        .and.returnValue(Promise.resolve('client_1')),
    };

    TestBed.configureTestingModule({
      providers: [
        SuperSyncWebSocketService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });

    service = TestBed.inject(SuperSyncWebSocketService);
  });

  afterEach(() => {
    service.disconnect();
    jasmine.clock().uninstall();
    (globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket =
      originalWebSocket;
  });

  it('should create a websocket with the encoded sync URL', async () => {
    await service.connect('https://sync.example.com', 'token with +/?');

    expect(MockWebSocket.instances).toHaveSize(1);
    expect(MockWebSocket.instances[0].url).toBe(
      'wss://sync.example.com/api/sync/ws?token=token%20with%20%2B%2F%3F&clientId=client_1',
    );
  });

  it('should emit notifications for new_ops messages', async () => {
    const received: number[] = [];
    service.newOpsNotification$.subscribe((notification) =>
      received.push(notification.latestSeq),
    );

    await service.connect('http://localhost:1901', 'token');
    MockWebSocket.instances[0].emitMessage({ type: 'new_ops', latestSeq: 7 });

    expect(received).toEqual([7]);
  });

  it('should respond to ping messages with pong', async () => {
    await service.connect('http://localhost:1901', 'token');
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ type: 'ping' });

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
  });

  it('should reconnect after an unexpected close', async () => {
    spyOn(Math, 'random').and.returnValue(0.5);

    await service.connect('http://localhost:1901', 'token');
    MockWebSocket.instances[0].emitClose(1006, 'network error');

    jasmine.clock().tick(1000);
    await Promise.resolve();

    expect(MockWebSocket.instances).toHaveSize(2);
    expect(MockWebSocket.instances[1].url).toContain('/api/sync/ws?token=token');
  });

  it('should not reconnect after auth failure', async () => {
    await service.connect('http://localhost:1901', 'token');
    MockWebSocket.instances[0].emitClose(4003, 'Invalid token');

    jasmine.clock().tick(60000);
    await Promise.resolve();

    expect(MockWebSocket.instances).toHaveSize(1);
  });

  it('should close the connection after heartbeat timeout', async () => {
    await service.connect('http://localhost:1901', 'token');
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    jasmine.clock().tick(45000);

    expect(ws.close).toHaveBeenCalledWith(4000, 'Heartbeat timeout');
  });

  it('should skip connecting when no client id is available', async () => {
    mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

    await service.connect('http://localhost:1901', 'token');

    expect(MockWebSocket.instances).toHaveSize(0);
  });

  it('should clear state on disconnect and be safe to call twice', async () => {
    await service.connect('http://localhost:1901', 'token');
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    expect(service.isConnected()).toBe(true);

    service.disconnect();

    expect(service.isConnected()).toBe(false);
    expect(ws.close).toHaveBeenCalled();

    // Calling disconnect a second time should not throw
    expect(() => service.disconnect()).not.toThrow();
  });

  it('should stop reconnecting after 50 attempts', async () => {
    spyOn(Math, 'random').and.returnValue(0.5);

    await service.connect('http://localhost:1901', 'token');

    for (let i = 0; i < 50; i++) {
      MockWebSocket.instances[MockWebSocket.instances.length - 1].emitClose(1006, 'drop');
      jasmine.clock().tick(60001);
      await Promise.resolve();
    }

    // After the 50th close, schedule reconnect should be a no-op (max reached)
    MockWebSocket.instances[MockWebSocket.instances.length - 1].emitClose(1006, 'drop');
    jasmine.clock().tick(60001);
    await Promise.resolve();

    // Original + 50 reconnects = 51, NOT 52
    expect(MockWebSocket.instances).toHaveSize(51);
  });

  it('should use exponential backoff capped at 60 seconds', async () => {
    spyOn(Math, 'random').and.returnValue(0.5);

    await service.connect('http://localhost:1901', 'token');

    // Close #1: baseDelay = 1000 * 2^0 = 1000ms
    MockWebSocket.instances[0].emitClose(1006, 'drop');
    jasmine.clock().tick(1000);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(2);

    // Close #2: baseDelay = 1000 * 2^1 = 2000ms
    MockWebSocket.instances[1].emitClose(1006, 'drop');
    jasmine.clock().tick(2000);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(3);

    // Close #3: baseDelay = 1000 * 2^2 = 4000ms
    MockWebSocket.instances[2].emitClose(1006, 'drop');
    jasmine.clock().tick(4000);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(4);

    // Close #4: baseDelay = 1000 * 2^3 = 8000ms
    MockWebSocket.instances[3].emitClose(1006, 'drop');
    jasmine.clock().tick(8000);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(5);

    // Fast-forward to attempt 7+: cap at 60000ms
    // Close #5 and #6 quickly
    MockWebSocket.instances[4].emitClose(1006, 'drop');
    jasmine.clock().tick(60001);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(6);

    MockWebSocket.instances[5].emitClose(1006, 'drop');
    jasmine.clock().tick(60001);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(7);

    // At attempt 7 (index 6), baseDelay = min(1000 * 2^6, 60000) = 60000
    // Verify that 59999ms is NOT enough
    MockWebSocket.instances[6].emitClose(1006, 'drop');
    jasmine.clock().tick(59999);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(7); // still 7

    // But 2ms more (total 60001ms) triggers it
    jasmine.clock().tick(2);
    await Promise.resolve();
    expect(MockWebSocket.instances).toHaveSize(8);
  });

  it('should handle connected message type without error', async () => {
    const received: number[] = [];
    service.newOpsNotification$.subscribe((notification) =>
      received.push(notification.latestSeq),
    );

    await service.connect('http://localhost:1901', 'token');
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ type: 'connected' });

    expect(received).toEqual([]);
    expect(service.isConnected()).toBe(true);
  });

  it('should convert http:// URL to ws://', async () => {
    await service.connect('http://localhost:1901', 'token');

    expect(MockWebSocket.instances[0].url).toMatch(/^ws:\/\//);
    expect(MockWebSocket.instances[0].url).not.toMatch(/^wss:\/\//);
  });

  it('should reset heartbeat timer on incoming message', async () => {
    await service.connect('http://localhost:1901', 'token');
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();

    // Advance 40s (close to 45s heartbeat timeout but not past it)
    jasmine.clock().tick(40000);
    ws.emitMessage({ type: 'ping' }); // resets heartbeat timer

    // Advance another 40s — only 40s since last message, heartbeat should NOT fire
    jasmine.clock().tick(40000);
    expect(ws.close).not.toHaveBeenCalled();

    // Advance 5001ms more — now 45001ms since last message
    jasmine.clock().tick(5001);
    expect(ws.close).toHaveBeenCalledWith(4000, 'Heartbeat timeout');
  });
});
