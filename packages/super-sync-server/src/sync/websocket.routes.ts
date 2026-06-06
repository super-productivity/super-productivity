import { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth';
import { getWsConnectionService } from './services/websocket-connection.service';
import { Logger } from '../logger';
import { isValidClientId } from './sync.const';

export const WS_CONNECTION_RATE_LIMIT_MAX = 120;
export const WS_CONNECTION_RATE_LIMIT_WINDOW = '1 minute';

/**
 * Rate-limit key for the WS upgrade endpoint. Keyed by (ip, clientId) instead
 * of ip alone so a single hammering client (pre-18.6.0 reconnect-on-close
 * loop) exhausts only its own quota and does not poison other clients sharing
 * the same NAT. Per-IP amplification is bounded by the server-wide 500/15min
 * cap registered in server.ts. Falls back to ip when clientId is missing or
 * invalid (route handler rejects those with 4001).
 *
 * Exported for direct unit testing — the inline keyGenerator option on
 * @fastify/rate-limit is otherwise unreachable from tests.
 */
export const wsRateLimitKeyGenerator = (req: FastifyRequest): string => {
  const cid = (req.query as { clientId?: unknown } | undefined)?.clientId;
  return isValidClientId(cid) ? `${req.ip}:${cid}` : req.ip;
};

export const wsRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get(
    '/ws',
    {
      websocket: true,
      config: {
        rateLimit: {
          max: WS_CONNECTION_RATE_LIMIT_MAX,
          timeWindow: WS_CONNECTION_RATE_LIMIT_WINDOW,
          keyGenerator: wsRateLimitKeyGenerator,
        },
      },
    },
    async (
      socket,
      req: FastifyRequest<{
        Querystring: { token?: string; clientId?: string };
      }>,
    ) => {
      try {
        const { token, clientId } = req.query as {
          token?: string;
          clientId?: string;
        };

        // Validate token
        if (!token) {
          Logger.warn('[ws] Connection rejected: missing token');
          socket.close(4001, 'Missing token');
          return;
        }

        // Validate clientId
        if (!isValidClientId(clientId)) {
          Logger.warn('[ws] Connection rejected: invalid clientId');
          socket.close(4001, 'Invalid clientId');
          return;
        }

        const result = await verifyToken(token);
        if (!result.valid) {
          Logger.warn(`[ws] Connection rejected: ${result.reason}`);
          socket.close(4003, 'Invalid token');
          return;
        }

        const wsService = getWsConnectionService();
        wsService.addConnection(result.userId, clientId, socket);
      } catch (err) {
        Logger.error('[ws] Unexpected error in WebSocket handler:', err);
        try {
          socket.close(1011, 'Internal error');
        } catch (closeErr) {
          Logger.debug('[ws] Failed to close socket after error', closeErr);
        }
      }
    },
  );
};
