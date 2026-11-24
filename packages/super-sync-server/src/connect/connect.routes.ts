import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, getAuthUser } from '../middleware';
import { signAccountToken } from '../auth';
import {
  approveConnectRequest,
  cancelConnectRequest,
  CONNECT_PLATFORMS,
  CONNECT_POLL_INTERVAL_MS,
  CONNECT_POLL_SECRET_PATTERN,
  CONNECT_REQUEST_ID_PATTERN,
  createConnectRequest,
  getPendingConnectRequest,
  pollConnectRequest,
} from './connect-request.store';

/**
 * Browser sign-in of a new device, mounted at /api/connect for every server.
 * See connect-request.store.ts for the flow.
 */

const CreateSchema = z.object({
  // Shown on the Connect page, which renders it as text, never as HTML.
  deviceName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\p{Cc}]+$/u),
  platform: z.enum(CONNECT_PLATFORMS),
});
const ParamsSchema = z.object({ id: z.string().regex(CONNECT_REQUEST_ID_PATTERN) });
const PollSchema = z.object({
  pollSecret: z.string().regex(CONNECT_POLL_SECRET_PATTERN),
});

const NOT_FOUND = {
  error: 'This sign-in request expired or was already used. Start again in the app.',
};
// Per IP: create needs no login, so it is the spam surface.
const PER_IP_LIMIT = { rateLimit: { max: 10, timeWindow: '15 minutes' } };
const PAGE_LIMIT = { rateLimit: { max: 30, timeWindow: '15 minutes' } };
// Per request, not per IP: a shared home or office IP polls for several devices.
// About twice what polling every CONNECT_POLL_INTERVAL_MS for the full lifetime needs.
const POLL_LIMIT = {
  rateLimit: {
    max: 400,
    timeWindow: '10 minutes',
    keyGenerator: (req: FastifyRequest): string =>
      `connect-poll:${(req.params as { id?: string }).id ?? ''}`,
  },
};

export const connectRoutes = async (fastify: FastifyInstance): Promise<void> => {
  fastify.addHook('onRequest', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
  });

  fastify.post(
    '/requests',
    { bodyLimit: 1024, config: PER_IP_LIMIT },
    async (req, reply) => {
      const body = CreateSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Invalid device' });
      const created = await createConnectRequest(body.data);
      return reply.send({ ...created, pollIntervalMs: CONNECT_POLL_INTERVAL_MS });
    },
  );

  fastify.get(
    '/requests/:id',
    { preHandler: authenticate, config: PAGE_LIMIT },
    async (req, reply) => {
      const params = ParamsSchema.safeParse(req.params);
      const request = params.success
        ? await getPendingConnectRequest(params.data.id)
        : null;
      return request ? reply.send(request) : reply.code(404).send(NOT_FOUND);
    },
  );

  fastify.post(
    '/requests/:id/approve',
    { preHandler: authenticate, config: PAGE_LIMIT },
    async (req, reply) => {
      const params = ParamsSchema.safeParse(req.params);
      const user = getAuthUser(req);
      const approved =
        params.success && (await approveConnectRequest(params.data.id, user));
      return approved ? reply.send({ ok: true }) : reply.code(404).send(NOT_FOUND);
    },
  );

  fastify.post(
    '/requests/:id/cancel',
    { preHandler: authenticate, config: PAGE_LIMIT },
    async (req, reply) => {
      const params = ParamsSchema.safeParse(req.params);
      const user = getAuthUser(req);
      const cancelled =
        params.success && (await cancelConnectRequest(params.data.id, user.userId));
      return cancelled ? reply.send({ ok: true }) : reply.code(404).send(NOT_FOUND);
    },
  );

  fastify.post(
    '/requests/:id/poll',
    { bodyLimit: 1024, config: POLL_LIMIT },
    async (req, reply) => {
      const params = ParamsSchema.safeParse(req.params);
      const body = PollSchema.safeParse(req.body);
      if (!params.success || !body.success) return reply.send({ status: 'expired' });
      const result = await pollConnectRequest(params.data.id, body.data.pollSecret);
      if (result.status !== 'approved') return reply.send({ status: result.status });
      const token = signAccountToken(result.userId, result.email, result.tokenVersion);
      return reply.send({ status: 'approved', token });
    },
  );
};
