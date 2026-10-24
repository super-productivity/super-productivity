import {
  createCipheriv,
  createECDH,
  createHash,
  createPublicKey,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/supersync.fixture';
import {
  closeClient,
  createSimulatedClient,
  createTestUser,
  getSuperSyncConfig,
  getTaskElement,
  SUPERSYNC_BASE_URL,
  waitForTask,
  type SimulatedE2EClient,
  type TestUser,
} from '../../utils/supersync-helpers';

/**
 * Android share over SuperSync capture
 * (docs/plans/2026-10-24-android-share-capture.md): the phone seals a share
 * itself and POSTs it to /api/capture/items; after a sync, any device imports
 * exactly one Inbox task with the link attached, and the others get it by
 * normal sync. This test plays the phone with the same seal as CaptureSeal.kt.
 * Needs the server started with CAPTURE_CONNECTOR_ENABLED=true.
 */

const IMPORT_TIMEOUT = 120_000;
const LINK = 'https://example.com/shared-article';

/** CaptureSeal.kt / capture-seal.ts: ECDH P-256 + HKDF-SHA-256 + AES-256-GCM. */
const seal = (publicKeySpki: string, itemId: string, payload: unknown): string => {
  const jwk = createPublicKey({
    key: Buffer.from(publicKeySpki, 'base64'),
    format: 'der',
    type: 'spki',
  }).export({ format: 'jwk' });
  const userPoint = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x as string, 'base64url'),
    Buffer.from(jwk.y as string, 'base64url'),
  ]);
  const ephemeral = createECDH('prime256v1');
  const ephemeralPoint = ephemeral.generateKeys();
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      ephemeral.computeSecret(userPoint),
      Buffer.alloc(0),
      Buffer.concat([Buffer.from('sp-capture-v1'), ephemeralPoint, userPoint]),
      32,
    ),
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([Buffer.from([0x01]), Buffer.from(itemId)]));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([
    Buffer.from([0x01]),
    ephemeralPoint,
    iv,
    body,
    cipher.getAuthTag(),
  ]).toString('base64');
};

const fingerprint = (publicKeySpki: string): string =>
  createHash('sha256').update(Buffer.from(publicKeySpki, 'base64')).digest('base64url');

const api = (
  user: TestUser,
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<Response> => {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${user.token}`);
  return fetch(`${SUPERSYNC_BASE_URL}/api/capture${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};

const switchOnCapture = async (client: SimulatedE2EClient): Promise<void> => {
  const dialog = await client.sync.openSuperSyncSettings();
  const capture = dialog.locator('agent-capture-settings');
  await capture.locator('details.agent-capture > summary').click();
  await capture.getByRole('button', { name: 'Let AI assistants add tasks' }).click();
  await expect(capture.getByRole('button', { name: 'Turn off' })).toBeVisible();
  await dialog.getByRole('button', { name: /cancel/i }).click();
  await expect(dialog).toBeHidden();
};

/** The synced capture public key, as the bridge mirrors it to the phone. */
const getCapturePublicKey = (page: Page): Promise<string> =>
  page.evaluate(() => {
    type StoreLike = {
      subscribe: (next: (s: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: { globalConfig: { sync: { captureKey?: { publicKeySpki: string } } } };
    store.subscribe((s) => (state = s as typeof state)).unsubscribe();
    const key = state!.globalConfig.sync.captureKey?.publicKeySpki;
    if (!key) throw new Error('capture key missing');
    return key;
  });

interface StoredTask {
  notes: string;
  projectId: string;
  attachments: Array<{ type: string; path: string }>;
}

const getTasksByTitle = (page: Page, title: string): Promise<StoredTask[]> =>
  page.evaluate((taskTitle) => {
    type StoreLike = {
      subscribe: (next: (s: unknown) => void) => { unsubscribe: () => void };
    };
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) throw new Error('__e2eTestHelpers.store missing');
    let state: {
      tasks: { entities: Record<string, (StoredTask & { title: string }) | undefined> };
    };
    store.subscribe((s) => (state = s as typeof state)).unsubscribe();
    return Object.values(state!.tasks.entities)
      .filter((t): t is StoredTask & { title: string } => t?.title === taskTitle)
      .map(({ notes, projectId, attachments }) => ({ notes, projectId, attachments }));
  }, title);

const expectInboxTask = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  // Hash navigation, not page.goto: a reload would restart the import trigger.
  await client.page.evaluate(() => (location.hash = '#/project/INBOX_PROJECT/tasks'));
  await waitForTask(client.page, title, IMPORT_TIMEOUT);
  await expect(getTaskElement(client, title)).toHaveCount(1, { timeout: IMPORT_TIMEOUT });
  const tasks = await getTasksByTitle(client.page, title);
  expect(tasks).toEqual([
    {
      // Notes that only repeat the link are dropped; the link is the attachment.
      notes: '',
      projectId: 'INBOX_PROJECT',
      attachments: [expect.objectContaining({ type: 'LINK', path: LINK })],
    },
  ]);
};

test.describe('@supersync Android share capture', () => {
  let clientA: SimulatedE2EClient | null = null;
  let clientB: SimulatedE2EClient | null = null;

  test.beforeEach(() => {
    test.setTimeout(400_000);
    clientA = null;
    clientB = null;
  });

  test.afterEach(async () => {
    if (clientA) await closeClient(clientA);
    if (clientB) await closeClient(clientB);
  });

  test('a share sealed on the phone becomes one Inbox task with its link, on every device', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const user = await createTestUser(testRunId);
    clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    await clientA.sync.setupSuperSync(getSuperSyncConfig(user));
    await switchOnCapture(clientA);
    const publicKey = await getCapturePublicKey(clientA.page);

    // Short syntax must stay literal, as for every share.
    const title = `Shared-${testRunId} #later +work`;
    const id = randomUUID();
    const item = {
      id,
      fingerprint: fingerprint(publicKey),
      ciphertext: seal(publicKey, id, {
        v: 1,
        title,
        notes: LINK,
        link: LINK,
        createdAt: Date.now(),
        client: 'Android share',
      }),
    };
    // The phone's retry after a lost response stores nothing new.
    for (let i = 0; i < 2; i++) {
      const res = await api(user, '/items', item);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'queued' });
    }
    const grants = await (await api(user, '/grants')).json();
    expect(grants.otherPendingCount).toBe(1);

    await clientA.sync.syncAndWait();
    await expectInboxTask(clientA, title);
    await expect
      .poll(async () => (await (await api(user, '/grants')).json()).otherPendingCount, {
        timeout: IMPORT_TIMEOUT,
        intervals: [2_000],
      })
      .toBe(0);

    await clientA.sync.syncAndWait();
    clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
    await clientB.sync.setupSuperSync(getSuperSyncConfig(user));
    await clientB.sync.syncAndWait();
    await expectInboxTask(clientB, title);
    await clientB.sync.syncAndWait();
    await expectInboxTask(clientB, title);
  });

  test('refuses a share sealed to another key, so the phone keeps it', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const user = await createTestUser(testRunId);
    clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
    await clientA.sync.setupSuperSync(getSuperSyncConfig(user));
    await switchOnCapture(clientA);

    const other = createECDH('prime256v1');
    other.generateKeys();
    const otherSpki = Buffer.concat([
      Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
      other.getPublicKey(),
    ]).toString('base64');
    const id = randomUUID();
    const res = await api(user, '/items', {
      id,
      fingerprint: fingerprint(otherSpki),
      ciphertext: seal(otherSpki, id, { v: 1, title: 'x', createdAt: 1, client: 'x' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'key_mismatch' });
  });
});
