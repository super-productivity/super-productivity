import { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth';
import { getWsConnectionService } from './services/websocket-connection.service';
import { Logger } from '../logger';

// Validation constants (same as sync.routes.ts)
const CLIENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_CLIENT_ID_LENGTH = 255;

export const wsRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.get(
    '/ws',
    { websocket: true },
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

        const user = await verifyToken(token);
        if (!user) {
          Logger.warn('[ws] Connection rejected: invalid token');
          socket.close(4003, 'Invalid token');
          return;
        }

        const wsService = getWsConnectionService();
        wsService.addConnection(user.userId, clientId, socket);
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
