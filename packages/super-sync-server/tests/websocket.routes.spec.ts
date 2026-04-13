import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CLIENT_ID_REGEX, MAX_CLIENT_ID_LENGTH } from '../src/sync/sync.const';

/**
 * Tests the WebSocket route validation logic from websocket.routes.ts.
 *
 * The route handler performs three sequential validations before accepting a connection:
 * 1. Token must be present
 * 2. ClientId must match CLIENT_ID_REGEX and be within MAX_CLIENT_ID_LENGTH
 * 3. Token must pass verifyToken() check
 *
 * Since Fastify's inject() does not support WebSocket upgrades, we test the
 * validation logic directly — the regex, length check, and handler flow —
 * rather than spinning up a real server.
 */

vi.mock('../src/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const mockAddConnection = vi.fn();

vi.mock('../src/sync/services/websocket-connection.service', () => ({
  getWsConnectionService: () => ({
    addConnection: mockAddConnection,
  }),
  resetWsConnectionService: vi.fn(),
}));

// Import the already-mocked verifyToken (from tests/setup.ts)
const { verifyToken } = await import('../src/auth');

/**
 * Simulates the WebSocket route handler logic from websocket.routes.ts.
 * This mirrors the exact validation flow without needing @fastify/websocket.
 */
async function simulateWsHandler(
  query: { token?: string; clientId?: string },
  socket: { close: ReturnType<typeof vi.fn> },
): Promise<'accepted' | 'rejected'> {
  // Dynamic import to pick up the vi.mock above
  const { getWsConnectionService } = await import(
    '../src/sync/services/websocket-connection.service'
  );

  try {
    const { token, clientId } = query;

    if (!token) {
      socket.close(4001, 'Missing token');
      return 'rejected';
    }

    if (
      !clientId ||
      !CLIENT_ID_REGEX.test(clientId) ||
      clientId.length > MAX_CLIENT_ID_LENGTH
    ) {
      socket.close(4001, 'Invalid clientId');
      return 'rejected';
    }

    const result = await verifyToken(token);
    if (!result.valid) {
      socket.close(4003, 'Invalid token');
      return 'rejected';
    }

    const wsService = getWsConnectionService();
    wsService.addConnection(result.userId, clientId, socket as any);
    return 'accepted';
  } catch {
    try {
      socket.close(1011, 'Internal error');
    } catch {
      // ignore close error
    }
    return 'rejected';
  }
}

describe('WebSocket Route Validation', () => {
  let mockSocket: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockSocket = { close: vi.fn() };
    mockAddConnection.mockReset();
    vi.mocked(verifyToken).mockResolvedValue({
      valid: true,
      userId: 1,
      email: 'test@test.com',
    });
  });

  describe('CLIENT_ID_REGEX', () => {
    it('should accept alphanumeric characters', () => {
      expect(CLIENT_ID_REGEX.test('abc123')).toBe(true);
    });

    it('should accept underscores and hyphens', () => {
      expect(CLIENT_ID_REGEX.test('client_ID-123')).toBe(true);
    });

    it('should reject special characters', () => {
      expect(CLIENT_ID_REGEX.test('invalid!@#')).toBe(false);
    });

    it('should reject spaces', () => {
      expect(CLIENT_ID_REGEX.test('has space')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(CLIENT_ID_REGEX.test('')).toBe(false);
    });

    it('should reject dots', () => {
      expect(CLIENT_ID_REGEX.test('client.id')).toBe(false);
    });
  });

  describe('MAX_CLIENT_ID_LENGTH', () => {
    it('should be 255', () => {
      expect(MAX_CLIENT_ID_LENGTH).toBe(255);
    });
  });

  describe('handler validation flow', () => {
    it('should reject when token is missing', async () => {
      const result = await simulateWsHandler(
        { clientId: 'valid_client' },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4001, 'Missing token');
    });

    it('should reject when token is empty string', async () => {
      const result = await simulateWsHandler(
        { token: '', clientId: 'valid_client' },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4001, 'Missing token');
    });

    it('should reject when clientId is missing', async () => {
      const result = await simulateWsHandler({ token: 'some-token' }, mockSocket);

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4001, 'Invalid clientId');
    });

    it('should reject when clientId has invalid characters', async () => {
      const result = await simulateWsHandler(
        { token: 'some-token', clientId: 'bad!!!id' },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4001, 'Invalid clientId');
    });

    it('should reject when clientId exceeds max length', async () => {
      const result = await simulateWsHandler(
        { token: 'some-token', clientId: 'a'.repeat(256) },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4001, 'Invalid clientId');
    });

    it('should accept clientId at exactly max length', async () => {
      const result = await simulateWsHandler(
        { token: 'good-token', clientId: 'a'.repeat(255) },
        mockSocket,
      );

      expect(result).toBe('accepted');
      expect(mockSocket.close).not.toHaveBeenCalled();
      expect(mockAddConnection).toHaveBeenCalledWith(1, 'a'.repeat(255), mockSocket);
    });

    it('should reject when verifyToken returns invalid', async () => {
      vi.mocked(verifyToken).mockResolvedValue({
        valid: false,
        reason: 'token expired',
      });

      const result = await simulateWsHandler(
        { token: 'expired-token', clientId: 'client_1' },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4003, 'Invalid token');
      expect(verifyToken).toHaveBeenCalledWith('expired-token');
    });

    it('should accept valid connection and call addConnection', async () => {
      const result = await simulateWsHandler(
        { token: 'good-token', clientId: 'client_1' },
        mockSocket,
      );

      expect(result).toBe('accepted');
      expect(verifyToken).toHaveBeenCalledWith('good-token');
      expect(mockAddConnection).toHaveBeenCalledWith(1, 'client_1', mockSocket);
      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should close with 1011 when verifyToken throws', async () => {
      vi.mocked(verifyToken).mockRejectedValue(new Error('database down'));

      const result = await simulateWsHandler(
        { token: 'some-token', clientId: 'client_1' },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(1011, 'Internal error');
    });

    it('should validate token before clientId format', async () => {
      const result = await simulateWsHandler({ clientId: 'bad!!!id' }, mockSocket);

      expect(result).toBe('rejected');
      expect(mockSocket.close).toHaveBeenCalledWith(4001, 'Missing token');
      expect(verifyToken).not.toHaveBeenCalled();
    });

    it('should validate clientId before calling verifyToken', async () => {
      const result = await simulateWsHandler(
        { token: 'some-token', clientId: 'bad!!!id' },
        mockSocket,
      );

      expect(result).toBe('rejected');
      expect(verifyToken).not.toHaveBeenCalled();
    });
  });
});
