import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './auth';

// User payload type
export interface AuthUser {
  userId: number;
  email: string;
}

// Extend FastifyRequest to include optional user (before auth)
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Helper to get authenticated user from request.
 * Use this in route handlers protected by the authenticate preHandler hook.
 * Throws if user is not set (should never happen after authenticate hook).
 */
export const getAuthUser = (req: FastifyRequest): AuthUser => {
  if (!req.user) {
    throw new Error('User not authenticated - missing auth middleware?');
  }
  return req.user;
};

export const authenticate = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];

  const payload = await verifyToken(token);
  if (!payload) {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  req.user = payload;
};
