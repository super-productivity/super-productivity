import { FastifyInstance } from 'fastify';
import { verifyEmail, verifyLoginMagicLink } from './auth';
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

/**
 * Safely serialize a value for embedding in a <script> tag.
 * Uses JSON.stringify and escapes sequences that could break out of script context.
 */
const safeJsonForScript = (value: unknown): string => {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c') // Escape < to prevent </script> injection
    .replace(/>/g, '\\u003e') // Escape > for completeness
    .replace(/&/g, '\\u0026'); // Escape & to prevent &lt; from being decoded
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
        <body>
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
          <script>
            const form = document.getElementById('resetForm');
            const errorEl = document.getElementById('error');
            const successEl = document.getElementById('success');
            const submitBtn = document.getElementById('submitBtn');

            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              errorEl.style.display = 'none';
              successEl.style.display = 'none';

              const password = document.getElementById('password').value;
              const confirmPassword = document.getElementById('confirmPassword').value;

              if (password !== confirmPassword) {
                errorEl.textContent = 'Passwords do not match';
                errorEl.style.display = 'block';
                return;
              }

              submitBtn.disabled = true;
              submitBtn.textContent = 'Resetting...';

              try {
                const response = await fetch('/api/reset-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: ${safeJsonForScript(token)}, password })
                });

                const data = await response.json();

                if (response.ok) {
                  successEl.textContent = data.message || 'Password reset successfully!';
                  successEl.style.display = 'block';
                  form.style.display = 'none';
                } else {
                  errorEl.textContent = data.error || 'Failed to reset password';
                  errorEl.style.display = 'block';
                  submitBtn.disabled = false;
                  submitBtn.textContent = 'Reset Password';
                }
              } catch (err) {
                errorEl.textContent = 'An error occurred. Please try again.';
                errorEl.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Reset Password';
              }
            });
          </script>
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
        <body>
          <div class="container">
            <h1>Recover Your Passkey</h1>
            <p>Click the button below to register a new passkey for your account. This will replace your existing passkey.</p>
            <button id="recoverBtn">Register New Passkey</button>
            <p class="error" id="error"></p>
            <p class="success" id="success"></p>
            <p class="info" id="info"></p>
          </div>
          <script>
            const recoverBtn = document.getElementById('recoverBtn');
            const errorEl = document.getElementById('error');
            const successEl = document.getElementById('success');
            const infoEl = document.getElementById('info');
            const token = ${safeJsonForScript(token)};

            recoverBtn.addEventListener('click', async () => {
              errorEl.style.display = 'none';
              successEl.style.display = 'none';
              infoEl.textContent = '';
              recoverBtn.disabled = true;
              recoverBtn.textContent = 'Preparing...';

              try {
                // Step 1: Get registration options from server
                const optionsRes = await fetch('/api/recover/passkey/options', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token })
                });

                if (!optionsRes.ok) {
                  const data = await optionsRes.json();
                  throw new Error(data.error || 'Failed to get registration options');
                }

                const { options } = await optionsRes.json();

                // Step 2: Create passkey using browser API
                infoEl.textContent = 'Please follow your browser/device prompt to create a new passkey...';
                recoverBtn.textContent = 'Waiting for passkey...';

                const credential = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });

                // Step 3: Send credential to server for verification
                recoverBtn.textContent = 'Verifying...';
                infoEl.textContent = '';

                const completeRes = await fetch('/api/recover/passkey/complete', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token, credential })
                });

                const completeData = await completeRes.json();

                if (completeRes.ok) {
                  successEl.textContent = completeData.message || 'Passkey registered successfully!';
                  successEl.style.display = 'block';
                  recoverBtn.style.display = 'none';
                  infoEl.innerHTML = '<a href="/" style="color: #3b82f6;">Return to Login</a>';
                } else {
                  throw new Error(completeData.error || 'Failed to complete recovery');
                }
              } catch (err) {
                console.error('Passkey recovery error:', err);
                errorEl.textContent = err.message || 'An error occurred. Please try again.';
                errorEl.style.display = 'block';
                recoverBtn.disabled = false;
                recoverBtn.textContent = 'Register New Passkey';
              }
            });
          </script>
        </body>
      </html>
    `);
    },
  );

  // Magic link login page - verifies token and displays JWT
  fastify.get<{ Querystring: MagicLoginQuery }>(
    '/magic-login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (req, reply) => {
      const { token } = req.query;
      if (!token) {
        return reply.status(400).send('Token is required');
      }

      try {
        // Verify the magic link token and get JWT
        const result = await verifyLoginMagicLink(token);

        // Redirect to main page with token in sessionStorage
        // Uses external script to avoid CSP inline script issues
        return reply.type('text/html').send(`
        <html>
          <head>
            <title>Login Successful</title>
          </head>
          <body data-token="${escapeHtml(result.token)}">
            <script src="/magic-login-redirect.js"></script>
          </body>
        </html>
        `);
      } catch (err) {
        Logger.error(`Magic link login error: ${errorMessage(err)}`);
        const safeError = escapeHtml(errorMessage(err));
        return reply.type('text/html').send(`
        <html>
          <head>
            <title>Login Failed</title>
            <style>
              body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; color: white; margin: 0; }
              .container { text-align: center; padding: 2rem; background: rgba(30, 41, 59, 0.7); border-radius: 1rem; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; width: 90%; }
              h1 { color: #ef4444; margin-bottom: 1rem; }
              p { color: #94a3b8; margin-bottom: 1.5rem; }
              a { color: #3b82f6; text-decoration: none; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Login Failed</h1>
              <p>${safeError}</p>
              <p><a href="/">Request a new login link</a></p>
            </div>
          </body>
        </html>
        `);
      }
    },
  );
}
