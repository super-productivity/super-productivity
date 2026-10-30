import { z } from 'zod';

const RedirectSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.hash &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  );
}, 'Redirects require HTTPS, except HTTP loopback callbacks');

export const CaptureOAuthClientsSchema = z
  .array(
    z.object({
      clientId: z.url().startsWith('https://'),
      name: z.string().trim().min(1).max(100),
      redirectUris: z.array(RedirectSchema).min(1).max(10),
    }),
  )
  .max(20)
  .refine(
    (clients) => new Set(clients.map((c) => c.clientId)).size === clients.length,
    'Client ids must be unique',
  );

export type CaptureOAuthClient = z.infer<typeof CaptureOAuthClientsSchema>[number];

// Pinned client identities; no client-controlled network fetches. Claude entries
// verified against Anthropic's public metadata on 2026-10-12.
export const DEFAULT_CAPTURE_OAUTH_CLIENTS: CaptureOAuthClient[] = [
  {
    clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    name: 'Claude',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  },
  {
    clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    name: 'Claude Code',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  },
  // ChatGPT's stable identity, used with servers that declare RFC 9207 `iss`.
  // Taken from OpenAI's connector auth docs, not fetched live. Its metadata
  // prefers private_key_jwt but it uses `none` + PKCE when that is all the
  // server advertises.
  {
    clientId: 'https://chatgpt.com/oauth/client.json',
    name: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  },
];

export const isAllowedCaptureRedirect = (
  client: CaptureOAuthClient,
  value: string,
): boolean => {
  let requested: URL;
  try {
    requested = new URL(value);
  } catch {
    return false;
  }
  return client.redirectUris.some((allowed) => {
    if (value === allowed) return true;
    const registered = new URL(allowed);
    if (
      registered.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(registered.hostname)
    )
      return false;
    requested.port = '';
    return requested.href === registered.href;
  });
};
