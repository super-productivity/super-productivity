/**
 * A deliberately small MCP server core: JSON-RPC over the Streamable HTTP
 * transport, stateless, JSON responses only, tools only.
 *
 * It speaks the initialize-based ("legacy era") protocol, 2025-03-26 through
 * 2025-11-25. Clients built for the per-request-metadata revision (2026-07-28)
 * detect a legacy server by getting a 400 whose body is not a recognised modern
 * error, then fall back to `initialize` — so this module must never emit the
 * modern-only error codes (-32020, -32022), which would make such a client
 * treat it as modern and retry instead of falling back.
 *
 * Kept free of Electron and HTTP so it can be unit tested on its own.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

// JSON-RPC 2.0 error codes.
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

type JsonRpcId = string | number;

export interface JsonRpcErrorBody {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string };
}

export interface JsonRpcResultBody {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export type JsonRpcResponseBody = JsonRpcErrorBody | JsonRpcResultBody;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpServerContext {
  serverVersion: string;
  /** The tools this caller may see and call. */
  listTools: () => McpToolDefinition[];
  /** Runs a tool this caller was granted; only called after hasTool(name). */
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
  hasTool: (name: string) => boolean;
}

/** What the HTTP layer should answer. `body: undefined` means an empty 202. */
export interface McpHttpReply {
  status: number;
  body?: JsonRpcResponseBody;
}

const MODERN_META_KEY = 'io.modelcontextprotocol/protocolVersion';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const errorBody = (
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcErrorBody => ({ jsonrpc: '2.0', id, error: { code, message } });

const isValidId = (id: unknown): id is JsonRpcId =>
  typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

/**
 * The `MCP-Protocol-Version` header: absent means 2025-03-26 and must be
 * accepted; anything else has to be a version this server speaks.
 */
export const isAcceptedProtocolHeader = (header: string | undefined): boolean =>
  header === undefined || SUPPORTED_PROTOCOL_VERSIONS.includes(header);

/**
 * A request shaped for the per-request-metadata era. Answered with a plain 400
 * so a dual-era client falls back to `initialize`.
 */
const isModernEraRequest = (
  message: Record<string, unknown>,
  mcpMethodHeader: string | undefined,
): boolean => {
  if (mcpMethodHeader !== undefined || message.method === 'server/discover') {
    return true;
  }
  const params = message.params;
  return isRecord(params) && isRecord(params._meta) && MODERN_META_KEY in params._meta;
};

/**
 * Handles one parsed JSON-RPC message (the HTTP body). `rawBody` is whatever
 * JSON.parse produced, so every shape has to be checked here.
 */
export const handleMcpMessage = async (
  rawBody: unknown,
  headers: { mcpMethod?: string },
  ctx: McpServerContext,
): Promise<McpHttpReply> => {
  if (Array.isArray(rawBody)) {
    // Batching was removed from the protocol in 2025-06-18.
    return {
      status: 400,
      body: errorBody(null, INVALID_REQUEST, 'Batch requests are not supported'),
    };
  }
  if (!isRecord(rawBody) || rawBody.jsonrpc !== '2.0') {
    return { status: 400, body: errorBody(null, INVALID_REQUEST, 'Invalid request') };
  }

  const hasMethod = typeof rawBody.method === 'string';
  const hasId = 'id' in rawBody;

  // Notifications (no id) and responses (no method) need no answer.
  if (!hasMethod || !hasId) {
    return { status: 202 };
  }
  if (!isValidId(rawBody.id)) {
    return { status: 400, body: errorBody(null, INVALID_REQUEST, 'Invalid id') };
  }
  const id = rawBody.id;

  if (isModernEraRequest(rawBody, headers.mcpMethod)) {
    return {
      status: 400,
      body: errorBody(
        id,
        INVALID_REQUEST,
        `This server supports protocol versions ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}; use initialize`,
      ),
    };
  }

  const params = isRecord(rawBody.params) ? rawBody.params : {};

  switch (rawBody.method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
      return {
        status: 200,
        body: {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'super-productivity', version: ctx.serverVersion },
          },
        },
      };
    }

    case 'ping':
      return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };

    case 'tools/list':
      return {
        status: 200,
        body: { jsonrpc: '2.0', id, result: { tools: ctx.listTools() } },
      };

    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !ctx.hasTool(name)) {
        // Deliberately the same answer for "does not exist" and "not granted":
        // a caller must not learn which tools other grants would unlock.
        return {
          status: 200,
          body: errorBody(id, INVALID_PARAMS, 'Unknown tool'),
        };
      }
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!isRecord(args)) {
        return {
          status: 200,
          body: errorBody(id, INVALID_PARAMS, 'Tool arguments must be an object'),
        };
      }
      const result = await ctx.callTool(name, args);
      return { status: 200, body: { jsonrpc: '2.0', id, result } };
    }

    default:
      return { status: 200, body: errorBody(id, METHOD_NOT_FOUND, 'Method not found') };
  }
};

export const parseErrorReply = (): McpHttpReply => ({
  status: 400,
  body: errorBody(null, PARSE_ERROR, 'Parse error'),
});

export const unsupportedVersionReply = (): McpHttpReply => ({
  status: 400,
  body: errorBody(
    null,
    INVALID_REQUEST,
    `Unsupported MCP-Protocol-Version; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
  ),
});
