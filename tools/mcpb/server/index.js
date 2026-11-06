#!/usr/bin/env node
/**
 * stdio → HTTP bridge for Super Productivity's assistant (MCP) access.
 *
 * Claude Desktop only launches local MCP servers over stdio, so this script —
 * packaged as a .mcpb Desktop Extension and run by Claude Desktop's own Node —
 * forwards every JSON-RPC message it reads on stdin to the running app's
 * endpoint at http://127.0.0.1:3876/mcp and writes the answer to stdout.
 *
 * It holds no state and no data: the app does all authorisation, permission
 * checks and validation. No dependencies, so it runs on a bare Node.
 */
'use strict';

const http = require('node:http');
const readline = require('node:readline');

const ENDPOINT = new URL(process.env.SP_MCP_URL || 'http://127.0.0.1:3876/mcp');
const ACCESS_KEY = process.env.SP_ACCESS_KEY || '';
// Longer than the app's own 45 s capture budget, so the app decides timeouts.
const REQUEST_TIMEOUT_MS = 60000;

const INTERNAL_ERROR = -32603;

const write = (message) => {
  process.stdout.write(JSON.stringify(message) + '\n');
};

const isRequest = (message) =>
  message !== null &&
  typeof message === 'object' &&
  typeof message.method === 'string' &&
  (typeof message.id === 'string' || typeof message.id === 'number');

const errorFor = (id, message) => ({
  jsonrpc: '2.0',
  id,
  error: { code: INTERNAL_ERROR, message },
});

const post = (body) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: ENDPOINT.hostname,
        port: ENDPOINT.port,
        path: ENDPOINT.pathname,
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          ...(ACCESS_KEY ? { Authorization: `Bearer ${ACCESS_KEY}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });

const explainStatus = (status, parsed) => {
  if (status === 401) {
    return 'Super Productivity rejected the access key. Generate a new one in Settings → Misc → Assistant access and update this extension.';
  }
  if (status === 503) {
    return 'Assistant access is switched off in Super Productivity (Settings → Misc).';
  }
  const detail = parsed && parsed.error && parsed.error.message;
  return detail
    ? `Super Productivity: ${detail}`
    : `Super Productivity answered HTTP ${status}.`;
};

const forward = async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  if (Array.isArray(message)) {
    // The protocol has no batches since 2025-06-18; answer instead of hanging.
    write({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Batch requests are not supported' },
    });
    return;
  }

  let reply;
  try {
    reply = await post(line);
  } catch (error) {
    if (isRequest(message)) {
      const reason =
        error && error.code === 'ECONNREFUSED'
          ? 'Super Productivity is not running, or its assistant access is switched off.'
          : 'Super Productivity did not answer.';
      write(errorFor(message.id, reason));
    }
    return;
  }

  if (!isRequest(message)) {
    // Notifications and responses: the app answers 202 with nothing to relay.
    return;
  }

  let parsed;
  try {
    parsed = reply.data ? JSON.parse(reply.data) : undefined;
  } catch {
    parsed = undefined;
  }

  // Relay a proper answer to this request as is; turn anything else (an
  // HTTP-level refusal without this request's id) into an error the client can
  // match to the request it is waiting on.
  if (parsed && parsed.jsonrpc === '2.0' && parsed.id === message.id) {
    write(parsed);
  } else {
    write(errorFor(message.id, explainStatus(reply.status, parsed)));
  }
};

// Messages are handled one at a time, in order, as a stdio client expects.
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) {
    return;
  }
  queue = queue.then(() => forward(line)).catch(() => undefined);
});
