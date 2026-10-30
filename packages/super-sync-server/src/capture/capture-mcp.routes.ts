import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from '../logger';
import { CAPTURE_MCP_BODY_LIMIT_BYTES } from './capture.const';
import {
  AuthenticatedGrant,
  authenticateCaptureToken,
  touchCaptureGrant,
} from './capture-grant.store';
import {
  isAuthFailureLimited,
  isGrantRateLimited,
  recordAuthFailure,
  recordAuthSuccess,
} from './capture-rate-limit';
import { parseCaptureToken } from './capture-token';
import { CREATE_TASK_TOOL, runCreateTask } from './create-task.tool';
import {
  handleMcpMessage,
  isAcceptedProtocolHeader,
  McpHttpReply,
  McpServerContext,
  parseErrorReply,
  unsupportedVersionReply,
} from './mcp-protocol';

/**
 * `POST /mcp`: the hosted, write-only MCP endpoint. Accepts only capture
 * tokens; a sync JWT is not a capture token and fails here, and the sync
 * `authenticate` preHandler is never registered on this route.
 *
 * No Origin check: the endpoint is public and bearer-only, so a browser page
 * has no ambient credential to abuse, and DNS rebinding targets local servers.
 */

const MCP_SERVER_VERSION = '1.0.0';

const headerValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const bearerToken = (req: FastifyRequest): string | null => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
};

const sendMcpReply = (reply: FastifyReply, result: McpHttpReply): FastifyReply =>
  result.body === undefined
    ? reply.code(result.status).send()
    : reply.code(result.status).type('application/json').send(result.body);

const contextFor = (grant: AuthenticatedGrant): McpServerContext => ({
  serverVersion: MCP_SERVER_VERSION,
  listTools: () => [CREATE_TASK_TOOL],
  hasTool: (name) => name === CREATE_TASK_TOOL.name,
  callTool: (_name, args) => runCreateTask(grant, args),
});

const handleMcpPost = async (
  req: FastifyRequest,
  reply: FastifyReply,
  publicUrl?: string,
): Promise<FastifyReply> => {
  const token = bearerToken(req);
  const claimedGrantId = (token && parseCaptureToken(token)?.grantId) || null;
  if (isAuthFailureLimited(req.ip, claimedGrantId)) {
    return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited' });
  }
  const grant = token
    ? await authenticateCaptureToken(
        token,
        Date.now(),
        publicUrl ? `${publicUrl}/mcp` : undefined,
      )
    : null;
  if (!grant) {
    recordAuthFailure(req.ip, claimedGrantId);
    const challenge = `Bearer scope="tasks:capture"${token ? ', error="invalid_token"' : ''}${publicUrl ? `, resource_metadata="${publicUrl}/.well-known/oauth-protected-resource/mcp"` : ''}`;
    return reply
      .code(401)
      .header('WWW-Authenticate', challenge)
      .send({ error: 'invalid_token' });
  }
  recordAuthSuccess(grant.grantId);
  if (isGrantRateLimited(grant.grantId)) {
    return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited' });
  }
  await touchCaptureGrant(grant.grantId);

  if (!isAcceptedProtocolHeader(headerValue(req.headers['mcp-protocol-version']))) {
    return sendMcpReply(reply, unsupportedVersionReply());
  }
  let message: unknown;
  try {
    message = JSON.parse(req.body as string);
  } catch {
    return sendMcpReply(reply, parseErrorReply());
  }
  const result = await handleMcpMessage(
    message,
    { mcpMethod: headerValue(req.headers['mcp-method']) },
    contextFor(grant),
  );
  if (result.body && 'error' in result.body) {
    // Ids only: capture content never goes to the log.
    Logger.debug(`MCP error for grant ${grant.grantId}: ${result.body.error.code}`);
  }
  return sendMcpReply(reply, result);
};

const methodNotAllowed = async (
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => reply.code(405).header('Allow', 'POST').send();

export const captureMcpRoutes = async (
  fastify: FastifyInstance,
  options: { publicUrl?: string } = {},
): Promise<void> => {
  // Raw text, so a malformed body becomes a JSON-RPC parse error rather than
  // a Fastify 400. Encapsulated: only affects routes in this plugin.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: CAPTURE_MCP_BODY_LIMIT_BYTES },
    (_req, body, done) => done(null, body),
  );

  // The global per-IP limiter is off here: assistant vendors call from shared
  // egress IPs. capture-rate-limit.ts counts per grant and failed auths per IP.
  const config = { rateLimit: false as const };
  fastify.post(
    '/mcp',
    { bodyLimit: CAPTURE_MCP_BODY_LIMIT_BYTES, config },
    (req, reply) => handleMcpPost(req, reply, options.publicUrl),
  );
  fastify.get('/mcp', { config }, methodNotAllowed);
  fastify.delete('/mcp', { config }, methodNotAllowed);
};
