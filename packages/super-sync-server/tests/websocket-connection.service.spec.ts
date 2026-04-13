import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocketConnectionService } from '../src/sync/services/websocket-connection.service';

vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const WS_OPEN = 1;
const WS_CLOSED = 3;

interface MockWs {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _handlers: Map<string, (...args: unknown[]) => void>;
  _emitPong: () => void;
  _emitClose: () => void;
  _emitMessage: (data: string) => void;
  _emitError: (err: Error) => void;
}

function createMockWs(): MockWs {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const mock: MockWs = {
    readyState: WS_OPEN,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    _handlers: handlers,
    _emitPong() {
      handlers.get('pong')?.();
    },
    _emitClose() {
      handlers.get('close')?.();
    },
    _emitMessage(data: string) {
      handlers.get('message')?.(Buffer.from(data));
    },
    _emitError(err: Error) {
      handlers.get('error')?.(err);
    },
  };
  return mock;
}

function parseSendCalls(mockWs: MockWs): Record<string, unknown>[] {
  return mockWs.send.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
}

describe('WebSocketConnectionService', () => {
  let service: WebSocketConnectionService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new WebSocketConnectionService();
  });

  afterEach(() => {
    service.stopHeartbeat();
    service.closeAll();
    vi.useRealTimers();
  });

  describe('addConnection', () => {
    it('should track a connection and send "connected" message', () => {
      const ws = createMockWs();

      service.addConnection(1, 'client-a', ws as any);

      expect(service.getConnectionCount()).toBe(1);
      const messages = parseSendCalls(ws);
      expect(messages).toContainEqual(expect.objectContaining({ type: 'connected' }));
    });

    it('should enforce max 10 connections per user', () => {
      const sockets: MockWs[] = [];
      for (let i = 0; i < 10; i++) {
        const ws = createMockWs();
        sockets.push(ws);
        service.addConnection(1, `client-${i}`, ws as any);
      }

      expect(service.getConnectionCount()).toBe(10);

      const eleventhWs = createMockWs();
      service.addConnection(1, 'client-10', eleventhWs as any);

      expect(eleventhWs.close).toHaveBeenCalledWith(4008, 'Too many connections');
      expect(service.getConnectionCount()).toBe(10);
    });

    it('should register close handler that removes connection', () => {
      const ws = createMockWs();
      service.addConnection(1, 'client-a', ws as any);

      expect(service.getConnectionCount()).toBe(1);

      ws._emitClose();

      expect(service.getConnectionCount()).toBe(0);
    });
  });

  describe('removeConnection', () => {
    it('should clean up empty user sets', () => {
      const ws = createMockWs();
      service.addConnection(1, 'client-a', ws as any);

      expect(service.getConnectionCount()).toBe(1);

      ws._emitClose();

      expect(service.getConnectionCount()).toBe(0);
    });

    it('should not call close() on already-closed WebSocket', () => {
      const ws = createMockWs();
      service.addConnection(1, 'client-a', ws as any);

      // Reset call count after addConnection (which may have called send, but not close)
      const closeCallsBefore = ws.close.mock.calls.length;

      // Mark the socket as already closed
      ws.readyState = WS_CLOSED;

      // Trigger the close event, which calls removeConnection internally
      ws._emitClose();

      // removeConnection should NOT have called ws.close since readyState is CLOSED
      expect(ws.close.mock.calls.length).toBe(closeCallsBefore);
    });
  });

  describe('notifyNewOps', () => {
    it('should send to other clients and exclude sender', () => {
      const wsA = createMockWs();
      const wsB = createMockWs();
      service.addConnection(1, 'A', wsA as any);
      service.addConnection(1, 'B', wsB as any);

      // Reset send mocks after the "connected" messages
      wsA.send.mockClear();
      wsB.send.mockClear();

      service.notifyNewOps(1, 'A', 5);
      vi.advanceTimersByTime(100);

      const messagesB = parseSendCalls(wsB);
      expect(messagesB).toContainEqual(
        expect.objectContaining({ type: 'new_ops', latestSeq: 5 }),
      );

      const messagesA = parseSendCalls(wsA);
      expect(messagesA).not.toContainEqual(expect.objectContaining({ type: 'new_ops' }));
    });

    it('should debounce rapid calls (latest-seq-wins)', () => {
      const wsB = createMockWs();
      service.addConnection(1, 'B', wsB as any);
      wsB.send.mockClear();

      service.notifyNewOps(1, 'A', 3);
      service.notifyNewOps(1, 'A', 7);
      vi.advanceTimersByTime(100);

      const messages = parseSendCalls(wsB);
      const newOpsMessages = messages.filter((m) => m.type === 'new_ops');
      expect(newOpsMessages).toHaveLength(1);
      expect(newOpsMessages[0]).toEqual(
        expect.objectContaining({ type: 'new_ops', latestSeq: 7 }),
      );
    });

    it('should accumulate excludeClientIds across debounced calls', () => {
      const wsA = createMockWs();
      const wsB = createMockWs();
      const wsC = createMockWs();
      service.addConnection(1, 'A', wsA as any);
      service.addConnection(1, 'B', wsB as any);
      service.addConnection(1, 'C', wsC as any);

      wsA.send.mockClear();
      wsB.send.mockClear();
      wsC.send.mockClear();

      service.notifyNewOps(1, 'A', 3);
      service.notifyNewOps(1, 'B', 5);
      vi.advanceTimersByTime(100);

      // Client A excluded from first call, client B excluded from second
      const messagesA = parseSendCalls(wsA);
      expect(messagesA).not.toContainEqual(expect.objectContaining({ type: 'new_ops' }));

      const messagesB = parseSendCalls(wsB);
      expect(messagesB).not.toContainEqual(expect.objectContaining({ type: 'new_ops' }));

      // Only client C should receive the notification
      const messagesC = parseSendCalls(wsC);
      expect(messagesC).toContainEqual(
        expect.objectContaining({ type: 'new_ops', latestSeq: 5 }),
      );
    });

    it('should no-op for nonexistent user', () => {
      expect(() => service.notifyNewOps(999, 'A', 1)).not.toThrow();
      vi.advanceTimersByTime(100);
    });
  });

  describe('startHeartbeat', () => {
    it('should send ping at interval', () => {
      const ws = createMockWs();
      service.addConnection(1, 'client-a', ws as any);
      ws.send.mockClear();

      service.startHeartbeat();
      vi.advanceTimersByTime(30_000);

      const messages = parseSendCalls(ws);
      expect(messages).toContainEqual(expect.objectContaining({ type: 'ping' }));
      expect(ws.ping).toHaveBeenCalled();
    });

    it('should remove dead connections when no pong response', () => {
      const ws = createMockWs();
      service.addConnection(1, 'client-a', ws as any);

      service.startHeartbeat();

      // First heartbeat tick: sends ping, connection is still alive
      // (Date.now() - lastPong is 30_000, which is less than 30_000 + 10_000 = 40_000)
      vi.advanceTimersByTime(30_000);
      expect(service.getConnectionCount()).toBe(1);

      // Second heartbeat tick: no pong received, so Date.now() - lastPong = 60_000 > 40_000
      vi.advanceTimersByTime(30_000);
      expect(service.getConnectionCount()).toBe(0);
    });

    it('should be idempotent', () => {
      service.startHeartbeat();
      service.startHeartbeat();

      const ws = createMockWs();
      service.addConnection(1, 'client-a', ws as any);
      ws.send.mockClear();

      vi.advanceTimersByTime(30_000);

      const pingMessages = parseSendCalls(ws).filter((m) => m.type === 'ping');
      expect(pingMessages).toHaveLength(1);
    });
  });

  describe('closeAll', () => {
    it('should close all connections with code 1001', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      service.addConnection(1, 'client-a', ws1 as any);
      service.addConnection(2, 'client-b', ws2 as any);

      expect(service.getConnectionCount()).toBe(2);

      service.closeAll();

      expect(ws1.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(ws2.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(service.getConnectionCount()).toBe(0);
    });
  });
});
