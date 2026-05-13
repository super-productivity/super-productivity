import { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth';
import { getWsConnectionService } from './services/websocket-connection.service';
import { Logger } from '../logger';
import { CLIENT_ID_REGEX, MAX_CLIENT_ID_LENGTH } from './sync.const';

export const WS_CONNECTION_RATE_LIMIT_MAX = 120;
export const WS_CONNECTION_RATE_LIMIT_WINDOW = '1 minute';

export const wsRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get(
    '/ws',
    {
      websocket: true,
      config: {
        rateLimit: {
          max: WS_CONNECTION_RATE_LIMIT_MAX,
          timeWindow: WS_CONNECTION_RATE_LIMIT_WINDOW,
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
        if (
          !clientId ||
          !CLIENT_ID_REGEX.test(clientId) ||
          clientId.length > MAX_CLIENT_ID_LENGTH
        ) {
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
