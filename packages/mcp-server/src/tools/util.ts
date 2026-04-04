import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}
