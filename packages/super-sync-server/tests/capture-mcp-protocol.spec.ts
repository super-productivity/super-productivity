import { describe, expect, it, vi } from 'vitest';
import {
  handleMcpMessage,
  INVALID_PARAMS,
  INVALID_REQUEST,
  isAcceptedProtocolHeader,
  McpServerContext,
  METHOD_NOT_FOUND,
} from '../src/capture/mcp-protocol';

/** The JSON-RPC core on its own; the routes spec covers the HTTP layer. */

const TOOL = {
  name: 'create_task',
  title: 'Add task',
  description: 'Adds a task',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    additionalProperties: false as const,
  },
  annotations: {
    title: 'Add task',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const context = (): McpServerContext & { callTool: ReturnType<typeof vi.fn> } => ({
  serverVersion: '1.0.0',
  listTools: () => [TOOL],
  hasTool: (name) => name === TOOL.name,
  callTool: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })),
});

const handle = (body: unknown, mcpMethod?: string, ctx = context()) =>
  handleMcpMessage(body, { mcpMethod }, ctx);

const errorCode = (reply: Awaited<ReturnType<typeof handle>>): number | undefined =>
  reply.body && 'error' in reply.body ? reply.body.error.code : undefined;

describe('handleMcpMessage', () => {
  it('answers notifications and responses with an empty 202', async () => {
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual(
      {
        status: 202,
      },
    );
    expect(await handle({ jsonrpc: '2.0', id: 1, result: {} })).toEqual({ status: 202 });
  });

  it('rejects batches, non-2.0 messages and invalid ids', async () => {
    for (const body of [
      [{ jsonrpc: '2.0', id: 1, method: 'ping' }],
      { jsonrpc: '1.0', id: 1, method: 'ping' },
      'ping',
      { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' },
      { jsonrpc: '2.0', id: Infinity, method: 'ping' },
    ]) {
      const reply = await handle(body);
      expect(reply.status).toBe(400);
      expect(errorCode(reply)).toBe(INVALID_REQUEST);
    }
  });

  it('negotiates a supported version and falls back to the latest', async () => {
    const init = (protocolVersion: string) =>
      handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion },
      });
    const versionOf = (reply: Awaited<ReturnType<typeof handle>>): unknown =>
      reply.body && 'result' in reply.body
        ? reply.body.result.protocolVersion
        : undefined;

    expect(versionOf(await init('2025-03-26'))).toBe('2025-03-26');
    expect(versionOf(await init('2099-01-01'))).toBe('2025-11-25');
  });

  it('names the server with a title and website', async () => {
    const reply = await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    });
    expect(reply.body && 'result' in reply.body && reply.body.result.serverInfo).toEqual({
      name: 'super-productivity',
      title: 'Super Productivity',
      version: '1.0.0',
      websiteUrl: 'https://super-productivity.com',
    });
  });

  it('answers a modern-era request with a plain 400 so the client falls back', async () => {
    const modern = [
      handle({ jsonrpc: '2.0', id: 1, method: 'server/discover' }, 'server/discover'),
      handle({ jsonrpc: '2.0', id: 2, method: 'server/discover' }),
      handle({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      }),
    ];
    for (const reply of await Promise.all(modern)) {
      expect(reply.status).toBe(400);
      // Never a modern-only code, which would make the client retry as modern.
      expect(errorCode(reply)).toBe(INVALID_REQUEST);
    }
  });

  it('gives the same answer for an unknown and an ungranted tool', async () => {
    const ctx = context();
    const call = (params: unknown) =>
      handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }, undefined, ctx);

    expect(errorCode(await call({ name: 'delete_task' }))).toBe(INVALID_PARAMS);
    expect(errorCode(await call({}))).toBe(INVALID_PARAMS);
    expect(errorCode(await call({ name: 'create_task', arguments: [] }))).toBe(
      INVALID_PARAMS,
    );
    expect(ctx.callTool).not.toHaveBeenCalled();

    const ok = await call({ name: 'create_task' });
    expect(ok.status).toBe(200);
    expect(ctx.callTool).toHaveBeenCalledWith('create_task', {});
  });

  it('answers an unknown method with method-not-found', async () => {
    expect(
      errorCode(await handle({ jsonrpc: '2.0', id: 'a', method: 'resources/list' })),
    ).toBe(METHOD_NOT_FOUND);
  });
});

describe('isAcceptedProtocolHeader', () => {
  it('accepts no header and supported versions only', () => {
    expect(isAcceptedProtocolHeader(undefined)).toBe(true);
    expect(isAcceptedProtocolHeader('2025-06-18')).toBe(true);
    expect(isAcceptedProtocolHeader('2026-07-28')).toBe(false);
  });
});
