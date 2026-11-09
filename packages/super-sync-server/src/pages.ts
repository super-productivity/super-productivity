import { FastifyInstance } from 'fastify';
import { getVerificationPreview } from './auth';
import { Logger } from './logger';
import { CONNECT_REQUEST_ID_PATTERN } from './connect/connect-request.store';

// Error response helper
const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : 'Unknown error';

// Basic HTML escape
const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

interface VerifyEmailQuery {
  token?: string;
  r?: string;
}

// Back to the login page in Connect mode when the email came from a new device's sign-in.
const loginPageHref = (connectRequestId?: string): string =>
  connectRequestId && CONNECT_REQUEST_ID_PATTERN.test(connectRequestId)
    ? `/?r=${connectRequestId}`
    : '/';

interface RecoverPasskeyQuery {
  token?: string;
}

interface MagicLoginQuery {
  token?: string;
  r?: string;
}

export async function pageRoutes(fastify: FastifyInstance) {
  // Email verification (#9032): the GET only renders a confirmation page
  // disambiguating which pending credential this link authorizes. It must
  // not consume the token itself: email clients prefetch links, and a
  // staged passkey must not activate just because the owner opened the
  // mail. The button POSTs to /api/verify-email (magic-login pattern).
  fastify.get<{ Querystring: VerifyEmailQuery }>(
    '/verify-email',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      try {
        const { token, r } = req.query;
        if (!token) {
          return reply.status(400).send('Token is required');
        }

        const preview = await getVerificationPreview(token);
        if (!preview) {
          return reply
            .status(400)
            .send('Verification failed: Invalid verification token');
        }

        const passkeyDetails =
          preview.kind === 'passkey'
            ? `
              <p>Passkey fingerprint: <code>${escapeHtml(preview.credentialFingerprint ?? '')}</code></p>
              <p>Passkey created: ${escapeHtml(preview.credentialCreatedAt?.toISOString() ?? '')}</p>
              <p>Transports: ${escapeHtml(preview.transports ?? 'unspecified')}</p>
              <p><strong>Only confirm if you created a passkey at that time.</strong>
              If you did not request this verification, do not confirm — start a new registration instead.</p>`
            : '<p>This link verifies your email address without a passkey.</p>';

        return reply.type('text/html').send(`
        <html>
          <head>
            <title>Verify your SuperSync account</title>
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0f172a; color: white; }
              .container { text-align: center; padding: 2rem; background: rgba(30, 41, 59, 0.7); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); max-width: 480px; }
              h1 { color: #3b82f6; }
              p { color: #94a3b8; margin-bottom: 1rem; line-height: 1.6; }
              button { width: 100%; padding: 0.75rem 1.5rem; background: #3b82f6; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
              button:disabled { background: #475569; cursor: not-allowed; }
              .error { color: #ef4444; margin-top: 1rem; display: none; }
              .success { color: #10b981; margin-top: 1rem; display: none; }
              a { color: #3b82f6; text-decoration: none; margin-top: 1rem; display: inline-block; }
            </style>
          </head>
          <body data-token="${escapeHtml(token)}" data-login-page="${loginPageHref(r)}">
            <div class="container">
              <h1>Verify your SuperSync account</h1>
              <p>Account: ${escapeHtml(preview.email)}</p>
              ${passkeyDetails}
              <button id="verify-btn">Verify Email</button>
              <p class="error" id="error"></p>
              <p class="success" id="success">Email verified! Redirecting...</p>
              <a href="${loginPageHref(r)}">Return to Login</a>
            </div>
            <script src="/verify-email-confirm.js"></script>
          </body>
        </html>
      `);
      } catch (err) {
        Logger.error(`Verification error: ${errorMessage(err)}`);
        // Escape the error message to prevent XSS
        const safeError = escapeHtml(errorMessage(err));
        return reply.status(400).send(`Verification failed: ${safeError}`);
      }
    },
  );

  // Passkey recovery page - allows user to register a new passkey
  fastify.get<{ Querystring: RecoverPasskeyQuery }>(
    '/recover-passkey',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const { token } = req.query;
      if (!token) {
        return reply.status(400).send('Token is required');
      }

      // Return HTML page for passkey recovery
      return reply.type('text/html').send(`
      <html>
        <head>
          <title>Recover Passkey</title>
          <script src="/simplewebauthn-browser.min.js"></script>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: white; margin: 0; }
            .container { text-align: center; padding: 2rem; background: rgba(30, 41, 59, 0.7); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; width: 90%; }
            h1 { color: #3b82f6; margin-bottom: 1.5rem; }
            p { color: #94a3b8; margin-bottom: 1.5rem; line-height: 1.6; }
            button { width: 100%; padding: 0.75rem 1.5rem; background: #3b82f6; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
            button:hover { background: #2563eb; }
            button:disabled { background: #475569; cursor: not-allowed; }
            .error { color: #ef4444; margin-top: 1rem; display: none; }
            .success { color: #10b981; margin-top: 1rem; display: none; }
            .info { font-size: 0.875rem; color: #64748b; margin-top: 1rem; }
          </style>
        </head>
        <body data-token="${escapeHtml(token)}">
          <div class="container">
            <h1>Recover Your Passkey</h1>
            <p>Click the button below to register a new passkey for your account. This will replace your existing passkey.</p>
            <button id="recoverBtn">Register New Passkey</button>
            <p class="error" id="error"></p>
            <p class="success" id="success"></p>
            <p class="info" id="info"></p>
          </div>
          <script src="/recover-passkey.js"></script>
        </body>
      </html>
    `);
    },
  );

  // Magic link login page - renders a confirmation page with a "Log In" button.
  // The GET request does NOT consume the single-use token. Instead, the button
  // triggers a POST to /api/login/magic-link/verify which verifies the token.
  // This two-step flow prevents email client link prefetchers (Outlook SafeLinks,
  // Gmail link preview, etc.) from consuming the token before the user clicks.
  fastify.get<{ Querystring: MagicLoginQuery }>(
    '/magic-login',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const { token } = req.query;
      if (!token) {
        return reply.status(400).send('Token is required');
      }

      // Render confirmation page — token is passed to the external script
      // via a data attribute. The script handles verification via POST.
      return reply.type('text/html').send(`
        <html>
          <head>
            <title>Complete Login</title>
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: white; margin: 0; }
              .container { text-align: center; padding: 2rem; background: rgba(30, 41, 59, 0.7); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; width: 90%; }
              h1 { color: #3b82f6; margin-bottom: 1rem; }
              p { color: #94a3b8; margin-bottom: 1.5rem; }
              button { width: 100%; padding: 0.75rem 1.5rem; background: #3b82f6; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; }
              button:hover { background: #2563eb; }
              button:disabled { background: #475569; cursor: not-allowed; }
              .error { color: #ef4444; margin-top: 1rem; display: none; }
              .success { color: #10b981; margin-top: 1rem; display: none; }
              a { color: #3b82f6; text-decoration: none; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body data-token="${escapeHtml(token)}" data-login-page="${loginPageHref(req.query.r)}">
            <div class="container">
              <h1>Complete Your Login</h1>
              <p>Click the button below to finish logging in to SuperSync.</p>
              <button id="login-btn">Log In</button>
              <p class="error" id="error"></p>
              <p class="success" id="success">Login successful! Redirecting...</p>
              <p style="margin-top: 1.5rem;"><a href="${loginPageHref(req.query.r)}">Request a new login link</a></p>
            </div>
            <script src="/magic-login-confirm.js"></script>
          </body>
        </html>
      `);
    },
  );
}
