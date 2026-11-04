import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
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

interface MockWs {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  _handlers: Map<string, (...args: unknown[]) => void>;
  _emitClose: () => void;
  _emitMessage: (data: string) => void;
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
    _emitClose() {
      handlers.get('close')?.();
    },
    _emitMessage(data: string) {
      handlers.get('message')?.(Buffer.from(data));
    },
  };
  return mock;
}

function sentMessages(mockWs: MockWs): Record<string, unknown>[] {
  return mockWs.send.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
}

function sentOfType(mockWs: MockWs, type: string): Record<string, unknown>[] {
  return sentMessages(mockWs).filter((m) => m.type === type);
}

const USER_ID = 1;
const OTHER_USER_ID = 2;

describe('WebSocketConnectionService presence relay', () => {
  let service: WebSocketConnectionService;

  beforeEach(() => {
    service = new WebSocketConnectionService();
  });

  const connect = (userId: number, clientId: string): MockWs => {
    const ws = createMockWs();
    service.addConnection(userId, clientId, ws as unknown as WebSocket);
    return ws;
  };

  const sendPresenceState = (ws: MockWs, payload: string): void => {
    ws._emitMessage(JSON.stringify({ type: 'presence_state', payload }));
  };

  it('relays presence_state to other sockets of the same user, not the sender', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');
    const otherUser = connect(OTHER_USER_ID, 'client-x');

    sendPresenceState(producer, 'STATE_1');

    const viewerMsgs = sentOfType(viewer, 'presence_state');
    expect(viewerMsgs).toHaveLength(1);
    expect(viewerMsgs[0].payload).toBe('STATE_1');
    expect(viewerMsgs[0].producerConnected).toBe(true);
    expect(sentOfType(producer, 'presence_state')).toHaveLength(0);
    expect(sentOfType(otherUser, 'presence_state')).toHaveLength(0);
  });

  it('assigns monotonically increasing server ordinals per user', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');

    sendPresenceState(producer, 'STATE_1');
    sendPresenceState(producer, 'STATE_2');

    const msgs = sentOfType(viewer, 'presence_state');
    expect(msgs.map((m) => m.ordinal)).toEqual([1, 2]);
  });

  it('sends the cached presence snapshot to a newly connecting viewer', () => {
    const producer = connect(USER_ID, 'client-a');
    sendPresenceState(producer, 'STATE_1');

    const lateViewer = connect(USER_ID, 'client-late');

    const msgs = sentOfType(lateViewer, 'presence_state');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].payload).toBe('STATE_1');
    expect(msgs[0].ordinal).toBe(1);
  });

  it('does not send the snapshot back to the reconnecting producer itself', () => {
    const producer = connect(USER_ID, 'client-a');
    connect(USER_ID, 'client-b');
    sendPresenceState(producer, 'STATE_1');
    producer._emitClose();

    // cooldown gate: a dead incumbent falls through to eviction, so a fresh
    // socket with the same clientId is accepted
    producer.readyState = 3; // CLOSED
    const reconnected = connect(USER_ID, 'client-a');

    const snapshotMsgs = sentOfType(reconnected, 'presence_state');
    expect(snapshotMsgs).toHaveLength(0);
  });

  it('broadcasts producerConnected:false when the producer socket closes, keeping the state', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');
    sendPresenceState(producer, 'STATE_1');

    producer._emitClose();

    const msgs = sentOfType(viewer, 'presence_state');
    expect(msgs).toHaveLength(2);
    expect(msgs[1].payload).toBe('STATE_1');
    expect(msgs[1].producerConnected).toBe(false);
  });

  it('broadcasts producerConnected:true again when the producer reconnects', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');
    sendPresenceState(producer, 'STATE_1');
    producer._emitClose();

    producer.readyState = 3; // CLOSED so the cooldown gate does not refuse
    connect(USER_ID, 'client-a');

    const msgs = sentOfType(viewer, 'presence_state');
    expect(msgs).toHaveLength(3);
    expect(msgs[2].producerConnected).toBe(true);
  });

  it('does not flag disconnect when a viewer (non-producer) socket closes', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');
    const viewer2 = connect(USER_ID, 'client-c');
    sendPresenceState(producer, 'STATE_1');

    viewer2._emitClose();

    const msgs = sentOfType(viewer, 'presence_state');
    expect(msgs).toHaveLength(1);
  });

  it('drops the cache once the last socket of the user is gone', () => {
    const producer = connect(USER_ID, 'client-a');
    sendPresenceState(producer, 'STATE_1');
    producer._emitClose();

    const lateViewer = connect(USER_ID, 'client-late');

    expect(sentOfType(lateViewer, 'presence_state')).toHaveLength(0);
  });

  it('relays presence_cmd without caching it', () => {
    const controller = connect(USER_ID, 'client-a');
    const producer = connect(USER_ID, 'client-b');

    controller._emitMessage(
      JSON.stringify({ type: 'presence_cmd', payload: 'CMD_STOP' }),
    );

    const cmdMsgs = sentOfType(producer, 'presence_cmd');
    expect(cmdMsgs).toHaveLength(1);
    expect(cmdMsgs[0].payload).toBe('CMD_STOP');
    expect(sentOfType(controller, 'presence_cmd')).toHaveLength(0);

    // no snapshot for a later connection: commands are not state
    const lateViewer = connect(USER_ID, 'client-late');
    expect(sentOfType(lateViewer, 'presence_state')).toHaveLength(0);
  });

  it('ignores oversized and non-string payloads', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');

    sendPresenceState(producer, 'x'.repeat(9_000));
    producer._emitMessage(JSON.stringify({ type: 'presence_state', payload: 42 }));
    producer._emitMessage(JSON.stringify({ type: 'presence_state' }));

    expect(sentOfType(viewer, 'presence_state')).toHaveLength(0);
  });

  it('rate-limits presence messages per connection instead of amplifying them', () => {
    const producer = connect(USER_ID, 'client-a');
    const viewer = connect(USER_ID, 'client-b');

    for (let i = 0; i < 100; i++) {
      sendPresenceState(producer, `state-${i}`);
    }

    const relayed = sentOfType(viewer, 'presence_state');
    expect(relayed.length).toBeGreaterThan(0);
    expect(relayed.length).toBeLessThan(30);
  });

  it('accepts presence again once the rate-limit window has passed', () => {
    vi.useFakeTimers();
    try {
      const producer = connect(USER_ID, 'client-a');
      const viewer = connect(USER_ID, 'client-b');

      for (let i = 0; i < 100; i++) {
        sendPresenceState(producer, `state-${i}`);
      }
      const countWhileLimited = sentOfType(viewer, 'presence_state').length;

      vi.advanceTimersByTime(11_000);
      sendPresenceState(producer, 'after-window');

      const relayed = sentOfType(viewer, 'presence_state');
      expect(relayed.length).toBe(countWhileLimited + 1);
      expect(relayed[relayed.length - 1].payload).toBe('after-window');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not send a snapshot older than the client hide window to new viewers', () => {
    vi.useFakeTimers();
    try {
      const producer = connect(USER_ID, 'client-a');
      sendPresenceState(producer, 'old-state');

      vi.advanceTimersByTime(31 * 60_000);
      const lateViewer = connect(USER_ID, 'client-b');

      expect(sentOfType(lateViewer, 'presence_state')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
