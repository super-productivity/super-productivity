import { Dropbox } from './dropbox';
import { DropboxApi } from './dropbox-api';
import { generateCodeChallenge } from '../../../../util/pkce.util';

/**
 * PKCE auth-helper lifecycle (issue #7139).
 *
 * Background: a user on Flatpak reported `invalid_grant: invalid code verifier`
 * after the "Get Authorization Code" button silently failed and they reopened
 * the auth dialog. Each call to `getAuthHelper()` used to generate a fresh
 * verifier+challenge, so a code obtained from the first URL was no longer
 * exchangeable with the second helper's verifier.
 *
 * Fix: cache the PKCE pair on the Dropbox instance and reuse it until the
 * exchange succeeds (or credentials are explicitly cleared).
 */
describe('Dropbox.getAuthHelper — PKCE lifecycle (issue #7139)', () => {
  it('returned authUrl carries a code_challenge derived from the returned codeVerifier', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });

    const helper = await dropbox.getAuthHelper();
    const authUrl = helper.authUrl as string;
    const codeVerifier = helper.codeVerifier as string;

    const challengeInUrl = new URL(authUrl).searchParams.get('code_challenge');
    const expectedChallenge = await generateCodeChallenge(codeVerifier);

    expect(challengeInUrl).toBe(expectedChallenge);
  });

  it('reuses the same codeVerifier across consecutive calls so a stale-but-original auth code still exchanges', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });

    const first = await dropbox.getAuthHelper();
    const second = await dropbox.getAuthHelper();

    expect(first.codeVerifier).toBe(second.codeVerifier);
    expect(first.authUrl).toBe(second.authUrl);
  });

  it('serializes concurrent getAuthHelper calls onto a single PKCE generation', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });

    const [first, second] = await Promise.all([
      dropbox.getAuthHelper(),
      dropbox.getAuthHelper(),
    ]);

    expect(first.codeVerifier).toBe(second.codeVerifier);
  });

  it('regenerates the codeVerifier after a successful exchange', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });
    const api = (dropbox as unknown as { _api: DropboxApi })._api;
    spyOn(api, 'getTokensFromAuthCode').and.resolveTo({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
    });

    const first = await dropbox.getAuthHelper();
    await first.verifyCodeChallenge!('any-code');
    const second = await dropbox.getAuthHelper();

    expect(second.codeVerifier).not.toBe(first.codeVerifier);
  });

  it('does not poison the cache when PKCE generation rejects', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });
    const originalSubtle = (globalThis.crypto as Crypto).subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      get: () => {
        throw new Error('crypto unavailable');
      },
    });

    try {
      await expectAsync(dropbox.getAuthHelper()).toBeRejected();
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', {
        configurable: true,
        value: originalSubtle,
      });
    }

    const recovered = await dropbox.getAuthHelper();
    expect(recovered.codeVerifier).toBeTruthy();
  });

  it('regenerates the codeVerifier after clearAuthCredentials()', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });

    const first = await dropbox.getAuthHelper();
    await dropbox.clearAuthCredentials();
    const second = await dropbox.getAuthHelper();

    expect(second.codeVerifier).not.toBe(first.codeVerifier);
  });
});
