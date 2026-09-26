import { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { verifyToken } from '../auth';
import { getWsConnectionService } from './services/websocket-connection.service';
import { Logger } from '../logger';
import { isValidClientId } from './sync.const';

export const WS_CONNECTION_RATE_LIMIT_MAX = 120;
export const WS_CONNECTION_RATE_LIMIT_WINDOW = '1 minute';
export const WS_IP_CONNECTION_RATE_LIMIT_MAX = 10_000;

/**
 * Grace period given to a peer to complete the WebSocket closing handshake
 * after we send a rejection close frame. `ws` itself will wait up to 30s
 * (CLOSE_TIMEOUT) for an uncooperative peer before destroying the underlying
 * TCP socket — see ws/lib/websocket.js. A peer that never echoes the close
 * frame costs it nothing but pins one fd + one ws.WebSocket (+ Receiver/
 * Sender) on the server for the full 30s. Since this route accepts the
 * upgrade BEFORE authenticating (required so the client can distinguish the
 * 4001/4003 close-code auth-failure contract from a generic 1006 drop — see
 * AUTH_FAILURE_CLOSE_CODE in super-sync-websocket.service.ts), an
 * unauthenticated caller can hold sockets open essentially for free. 1s is
 * long enough for any cooperative client to process the close code and echo
 * it back, but short enough that an uncooperative one can't meaningfully
 * exhaust fds. See #9885.
 */
export const WS_REJECTED_SOCKET_GRACE_MS = 1_000;

/**
 * Rejects a socket while bounding how long an uncooperative peer can keep it
 * alive. `socket.close(code, reason)` starts the polite closing handshake —
 * required to preserve the 4001/4003 wire contract the client relies on —
 * but does not itself guarantee timely teardown. This arms a short grace
 * timer and falls back to `socket.terminate()` (an immediate, handshake-free
 * TCP kill) if the peer hasn't completed the handshake by then. `terminate()`
 * is intentionally NOT used in place of `close()`: skipping the close frame
 * entirely would prevent the client from ever seeing the 4001/4003 code.
 *
 * Centralized here (rather than duplicating close+timer+terminate at each of
 * the four rejection sites below) so every rejection path gets the same
 * lifecycle guarantee.
 */
export const closeRejectedSocket = (
  socket: WebSocket,
  code: number,
  reason: string,
): void => {
  socket.close(code, reason);

  const timer = setTimeout(() => {
    if (socket.readyState !== WebSocket.CLOSED) {
      socket.terminate();
    }
  }, WS_REJECTED_SOCKET_GRACE_MS);

  // Don't let this timer keep the process alive on its own, and clear it
  // promptly once the handshake actually completes (cooperative peer).
  timer.unref?.();
  socket.once('close', () => clearTimeout(timer));
};

/**
 * Rate-limit key for the WS upgrade endpoint. Keyed by (ip, clientId) instead
 * of ip alone so a single hammering client (pre-18.6.0 reconnect-on-close
 * loop) exhausts only its own quota and does not poison other clients sharing
 * the same NAT. A separate 10,000/15min per-IP limiter bounds client-ID rotation
 * while allowing normal reconnect backoff for many clients behind one NAT.
 * Route-level limits override the global configuration. Falls back to ip when
 * clientId is missing or invalid (route handler rejects those with 4001).
 *
 * Exported for direct unit testing — the inline keyGenerator option on
 * @fastify/rate-limit is otherwise unreachable from tests.
 */
export const wsRateLimitKeyGenerator = (req: FastifyRequest): string => {
  const cid = (req.query as { clientId?: unknown } | undefined)?.clientId;
  return isValidClientId(cid) ? `${req.ip}:${cid}` : req.ip;
};

export const wsRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Test-mode servers deliberately do not register the rate-limit plugin.
  // createRateLimit is independent of the plugin's once-per-request hook flag,
  // so the aggregate check and the route's per-client check both run.
  const checkIpLimit = fastify.hasDecorator('createRateLimit')
    ? fastify.createRateLimit({
        max: WS_IP_CONNECTION_RATE_LIMIT_MAX,
        timeWindow: '15 minutes',
        keyGenerator: (req) => req.ip,
      })
    : undefined;
  fastify.get<{ Querystring: { token?: string; clientId?: string } }>(
    '/ws',
    {
      websocket: true,
      onRequest: checkIpLimit
        ? async (req, reply) => {
            const limit = await checkIpLimit(req);
            if (!limit.isAllowed && limit.isExceeded) {
              return reply.header('Retry-After', limit.ttlInSeconds).code(429).send({
                statusCode: 429,
                error: 'Too Many Requests',
                message: 'WebSocket connection rate limit exceeded',
              });
            }
          }
        : undefined,
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
          closeRejectedSocket(socket, 4001, 'Missing token');
          return;
        }

        // Validate clientId
        if (!isValidClientId(clientId)) {
          Logger.warn('[ws] Connection rejected: invalid clientId');
          closeRejectedSocket(socket, 4001, 'Invalid clientId');
          return;
        }

        const result = await verifyToken(token);
        if (!result.valid) {
          Logger.warn(`[ws] Connection rejected: ${result.reason}`);
          // 4003 = auth-failure wire contract; see TOKEN_REVOKED_CLOSE_CODE
          // (websocket-connection.service.ts) and the client's
          // AUTH_FAILURE_CLOSE_CODE (super-sync-websocket.service.ts).
          closeRejectedSocket(socket, 4003, 'Invalid token');
          return;
        }

        const wsService = getWsConnectionService();
        wsService.addConnection(result.userId, clientId, socket);
      } catch (err) {
        Logger.error('[ws] Unexpected error in WebSocket handler:', err);
        try {
          closeRejectedSocket(socket, 1011, 'Internal error');
        } catch (closeErr) {
          Logger.debug('[ws] Failed to close socket after error', closeErr);
        }
      }
    },
  );
};
