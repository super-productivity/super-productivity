import { Dropbox } from './dropbox';
import { generateCodeChallenge } from '../../../../util/pkce.util';

/**
 * Regression/demonstration tests for issue #7139 — the secondary PKCE-mismatch bug.
 *
 * Scenario: If the auth dialog is opened twice (e.g. user closes it after the
 * "Get Authorization Code" button fails to open the system browser), each call
 * to `getAuthHelper()` generates a fresh `codeVerifier` + matching `code_challenge`.
 * An auth code obtained from the FIRST authorization URL cannot be exchanged
 * using the SECOND helper's verifier — Dropbox rejects with `invalid_grant:
 * invalid code verifier`, which is exactly what the user reports.
 */
describe('Dropbox.getAuthHelper — PKCE lifecycle (issue #7139)', () => {
  it('returned authUrl must carry a code_challenge derived from the returned codeVerifier', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });

    const helper = await dropbox.getAuthHelper();
    const authUrl = helper.authUrl as string;
    const codeVerifier = helper.codeVerifier as string;

    const challengeInUrl = new URL(authUrl).searchParams.get('code_challenge');
    const expectedChallenge = await generateCodeChallenge(codeVerifier);

    expect(challengeInUrl).toBe(expectedChallenge);
  });

  it('regenerates codeVerifier on every call — stale auth codes will fail token exchange', async () => {
    const dropbox = new Dropbox({ appKey: 'test-key', basePath: '/' });

    const first = await dropbox.getAuthHelper();
    const second = await dropbox.getAuthHelper();

    expect(first.codeVerifier).not.toBe(second.codeVerifier);

    const c1 = new URL(first.authUrl as string).searchParams.get('code_challenge');
    const c2 = new URL(second.authUrl as string).searchParams.get('code_challenge');
    expect(c1).not.toBe(c2);

    // This is the crux of the user-visible bug: if the user ever opens the
    // dialog twice (common when the "Get Authorization Code" button silently
    // fails in Flatpak), the verifier paired with the first URL's challenge
    // is GONE. Entering an auth code obtained from the first URL produces
    // `invalid_grant: invalid code verifier`.
    const firstChallengeMatchesSecondVerifier =
      (await generateCodeChallenge(second.codeVerifier as string)) === c1;
    expect(firstChallengeMatchesSecondVerifier).toBe(false);
  });
});
