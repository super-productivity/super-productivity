import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// A new device's browser sign-in request (`r`) must survive the trip through the
// login and sign-up emails, so the email link lands on the Connect step.

const PENDING = 'p'.repeat(22);
const USED = 'u'.repeat(22);

const mocks = vi.hoisted(() => ({
  requestLoginMagicLink: vi.fn(),
  registerWithMagicLink: vi.fn(),
  verifyRegistration: vi.fn(),
  verifyEmail: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('../src/auth', () => ({
  requestLoginMagicLink: mocks.requestLoginMagicLink,
  registerWithMagicLink: mocks.registerWithMagicLink,
  verifyEmail: mocks.verifyEmail,
}));
vi.mock('../src/passkey', () => ({ verifyRegistration: mocks.verifyRegistration }));
vi.mock('../src/connect/connect-request.store', async (original) => ({
  ...(await original<object>()),
  pendingConnectRequestId: async (id?: string) => (id === PENDING ? id : undefined),
}));
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: mocks.sendMail }),
  getTestMessageUrl: () => false,
}));

describe('sign-in request in login and sign-up links', () => {
  let app: FastifyInstance;

  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api${url}`, payload });

  beforeEach(async () => {
    const { apiRoutes } = await import('../src/api');
    const { pageRoutes } = await import('../src/pages');
    mocks.requestLoginMagicLink.mockResolvedValue({ message: 'sent' });
    mocks.registerWithMagicLink.mockResolvedValue({ message: 'sent' });
    mocks.verifyRegistration.mockResolvedValue({ message: 'sent' });
    mocks.verifyEmail.mockResolvedValue(true);
    mocks.sendMail.mockResolvedValue({ messageId: 'm1' });
    app = Fastify();
    await app.register(apiRoutes, { prefix: '/api', requireTermsConsent: false });
    await app.register(pageRoutes, { prefix: '/' });
    await app.ready();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await app.close();
  });

  it('passes a pending request on to the login email, and drops any other', async () => {
    for (const [r, expected] of [
      [PENDING, PENDING],
      [USED, undefined],
      ['not-an-id', undefined],
      [undefined, undefined],
    ]) {
      mocks.requestLoginMagicLink.mockClear();
      const res = await post('/login/magic-link', { email: 'me@example.com', r });
      expect(res.statusCode).toBe(200);
      expect(mocks.requestLoginMagicLink).toHaveBeenCalledWith(
        'me@example.com',
        expected,
      );
    }
  });

  it('passes a pending request on to both sign-up emails', async () => {
    await post('/register/magic-link', { email: 'me@example.com', r: PENDING });
    expect(mocks.registerWithMagicLink).toHaveBeenCalledWith(
      'me@example.com',
      expect.any(Number),
      PENDING,
    );
    await post('/register/passkey/verify', {
      email: 'me@example.com',
      credential: {},
      r: PENDING,
    });
    expect(mocks.verifyRegistration).toHaveBeenCalledWith(
      'me@example.com',
      {},
      { termsAcceptedAt: expect.any(Number), connectRequestId: PENDING },
    );
  });

  it('puts the request into the emailed links only when given', async () => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    const { sendLoginMagicLinkEmail, sendVerificationEmail } =
      await import('../src/email');
    await sendLoginMagicLinkEmail('me@example.com', 'abc', PENDING);
    await sendVerificationEmail('me@example.com', 'abc', PENDING);
    await sendLoginMagicLinkEmail('me@example.com', 'abc');
    const texts = mocks.sendMail.mock.calls.map(([mail]) => mail.text as string);
    expect(texts[0]).toContain(`/magic-login?token=abc&r=${PENDING}`);
    expect(texts[1]).toContain(`/verify-email?token=abc&r=${PENDING}`);
    expect(texts[2]).toContain('/magic-login?token=abc\n');
  });

  it('leads the email pages back to the Connect step', async () => {
    const verified = await app.inject(`/verify-email?token=t&r=${PENDING}`);
    expect(verified.body).toContain(`<a href="/?r=${PENDING}">Return to Login</a>`);
    const login = await app.inject(`/magic-login?token=t&r=${PENDING}`);
    expect(login.body).toContain(`data-login-page="/?r=${PENDING}"`);
  });

  it('ignores a malformed request id on the email pages', async () => {
    const attack = encodeURIComponent('"><script>alert(1)</script>');
    const verified = await app.inject(`/verify-email?token=t&r=${attack}`);
    expect(verified.body).toContain('<a href="/">Return to Login</a>');
    const login = await app.inject(`/magic-login?token=t&r=${attack}`);
    expect(login.body).toContain('data-login-page="/"');
    expect(login.body).not.toContain('<script>alert');
  });
});
