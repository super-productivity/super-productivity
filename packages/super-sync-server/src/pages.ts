import { FastifyInstance } from 'fastify';
import { verifyEmail } from './auth';
import { Logger } from './logger';

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
}

interface ResetPasswordQuery {
  token?: string;
}

interface RecoverPasskeyQuery {
  token?: string;
}

interface MagicLoginQuery {
  token?: string;
}

export async function pageRoutes(fastify: FastifyInstance) {
  // Password reset page - shows form to enter new password
  fastify.get<{ Querystring: ResetPasswordQuery }>(
    '/reset-password',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const { token } = req.query;
      if (!token) {
        return reply.status(400).send('Token is required');
      }

      // Return HTML form for password reset
      return reply.type('text/html').send(`
      <html>
        <head>
          <title>Reset Password</title>
          <style>
            body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: white; margin: 0; }
            .container { text-align: center; padding: 2rem; background: rgba(30, 41, 59, 0.7); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; width: 90%; }
            h1 { color: #3b82f6; margin-bottom: 1.5rem; }
            .form-group { margin-bottom: 1rem; text-align: left; }
            label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
            input { width: 100%; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.2); border-radius: 0.5rem; background: rgba(15, 23, 42, 0.8); color: white; font-size: 1rem; box-sizing: border-box; }
            input:focus { outline: none; border-color: #3b82f6; }
            button { width: 100%; padding: 0.75rem 1.5rem; background: #3b82f6; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
            button:hover { background: #2563eb; }
            button:disabled { background: #475569; cursor: not-allowed; }
            .error { color: #ef4444; margin-top: 1rem; display: none; }
            .success { color: #10b981; margin-top: 1rem; display: none; }
            .requirements { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; }
          </style>
        </head>
        <body data-token="${escapeHtml(token)}">
          <div class="container">
            <h1>Reset Password</h1>
            <form id="resetForm">
              <div class="form-group">
                <label for="password">New Password</label>
                <input type="password" id="password" name="password" required minlength="12" />
                <div class="requirements">Minimum 12 characters</div>
              </div>
              <div class="form-group">
                <label for="confirmPassword">Confirm Password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" required />
              </div>
              <button type="submit" id="submitBtn">Reset Password</button>
            </form>
            <p class="error" id="error"></p>
            <p class="success" id="success"></p>
          </div>
          <script src="/reset-password.js"></script>
        </body>
      </html>
    `);
    },
  );

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
        const { token } = req.query;
        if (!token) {
          return reply.status(400).send('Token is required');
        }

        await verifyEmail(token);
        return reply.type('text/html').send(`
        <html>
          <head>
            <title>Email Verified</title>
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0f172a; color: white; }
              .container { text-align: center; padding: 2rem; background: rgba(30, 41, 59, 0.7); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); }
              h1 { color: #10b981; }
              a { color: #3b82f6; text-decoration: none; margin-top: 1rem; display: inline-block; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Email Verified!</h1>
              <p>Your account has been successfully verified.</p>
              <a href="/">Return to Login</a>
            </div>
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
          <body data-token="${escapeHtml(token)}">
            <div class="container">
              <h1>Complete Your Login</h1>
              <p>Click the button below to finish logging in to SuperSync.</p>
              <button id="login-btn">Log In</button>
              <p class="error" id="error"></p>
              <p class="success" id="success">Login successful! Redirecting...</p>
              <p style="margin-top: 1.5rem;"><a href="/">Request a new login link</a></p>
            </div>
            <script src="/magic-login-confirm.js"></script>
          </body>
        </html>
      `);
    },
  );
}
