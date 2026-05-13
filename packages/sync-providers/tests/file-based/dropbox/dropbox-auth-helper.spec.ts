import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Dropbox,
  type DropboxCfg,
  type DropboxDeps,
  type DropboxPrivateCfg,
  PROVIDER_ID_DROPBOX,
} from '../../../src/dropbox';
import { generateCodeChallenge } from '../../../src/pkce';
import type { NativeHttpExecutor } from '../../../src/http';
import type { SyncCredentialStorePort } from '../../../src/credential-store';
import { DropboxApi } from '../../../src/file-based/dropbox/dropbox-api';
import type { SyncLogger } from '@sp/sync-core';

type DropboxCredentialStore = SyncCredentialStorePort<
  typeof PROVIDER_ID_DROPBOX,
  DropboxPrivateCfg
>;

const noopLogger = (): SyncLogger => ({
  log: vi.fn(),
  error: vi.fn(),
  err: vi.fn(),
  normal: vi.fn(),
  verbose: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  critical: vi.fn(),
  debug: vi.fn(),
});

const createCredentialStore = (): DropboxCredentialStore => ({
  load: vi.fn().mockResolvedValue(null),
  setComplete: vi.fn(),
  updatePartial: vi.fn(),
  upsertPartial: vi.fn(),
  clear: vi.fn(),
});

const makeDropbox = (overrides: Partial<DropboxDeps> = {}): Dropbox => {
  const cfg: DropboxCfg = { appKey: 'test-key', basePath: '/' };
  const deps: DropboxDeps = {
    logger: noopLogger(),
    platformInfo: {
      isNativePlatform: false,
      isAndroidWebView: false,
      isIosNative: false,
    },
    webFetch: () => vi.fn() as unknown as typeof fetch,
    credentialStore: createCredentialStore(),
    nativeHttpExecutor: vi.fn<NativeHttpExecutor>(),
    ...overrides,
  };
  return new Dropbox(cfg, deps);
};

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returned authUrl carries a code_challenge derived from the returned codeVerifier', async () => {
    const dropbox = makeDropbox();

    const helper = await dropbox.getAuthHelper();
    const authUrl = helper.authUrl as string;
    const codeVerifier = helper.codeVerifier as string;

    const challengeInUrl = new URL(authUrl).searchParams.get('code_challenge');
    const expectedChallenge = await generateCodeChallenge(codeVerifier);

    expect(challengeInUrl).toBe(expectedChallenge);
  });

  it('reuses the same codeVerifier across consecutive calls so a stale-but-original auth code still exchanges', async () => {
    const dropbox = makeDropbox();

    const first = await dropbox.getAuthHelper();
    const second = await dropbox.getAuthHelper();

    expect(first.codeVerifier).toBe(second.codeVerifier);
    expect(first.authUrl).toBe(second.authUrl);
  });

  it('serializes concurrent getAuthHelper calls onto a single PKCE generation', async () => {
    const dropbox = makeDropbox();

    const [first, second] = await Promise.all([
      dropbox.getAuthHelper(),
      dropbox.getAuthHelper(),
    ]);

    expect(first.codeVerifier).toBe(second.codeVerifier);
  });

  it('regenerates the codeVerifier after a successful exchange', async () => {
    const dropbox = makeDropbox();
    const api = (dropbox as unknown as { _api: DropboxApi })._api;
    vi.spyOn(api, 'getTokensFromAuthCode').mockResolvedValue({
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
    const dropbox = makeDropbox();
    const originalSubtle = (globalThis.crypto as Crypto).subtle;

    Object.defineProperty(globalThis.crypto, 'subtle', {
      configurable: true,
      get: () => {
        throw new Error('crypto unavailable');
      },
    });

    try {
      await expect(dropbox.getAuthHelper()).rejects.toBeDefined();
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
    const credentialStore = createCredentialStore();
    let stored: DropboxPrivateCfg | null = null;
    (credentialStore.load as ReturnType<typeof vi.fn>).mockImplementation(
      async () => stored,
    );
    (credentialStore.setComplete as ReturnType<typeof vi.fn>).mockImplementation(
      async (cfg: DropboxPrivateCfg) => {
        stored = cfg;
      },
    );

    const dropbox = makeDropbox({ credentialStore });

    const first = await dropbox.getAuthHelper();
    await dropbox.clearAuthCredentials();
    const second = await dropbox.getAuthHelper();

    expect(second.codeVerifier).not.toBe(first.codeVerifier);
  });
});
