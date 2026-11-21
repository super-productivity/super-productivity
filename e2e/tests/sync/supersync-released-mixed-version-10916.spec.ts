import { expect } from '@playwright/test';
import { test } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import {
  loadedEntryScript,
  releasedEntryScript,
  serveReleasedClientAssets,
} from '../../utils/released-client-assets';

/**
 * #10916: a v19.1.0 desktop and a v19.2.0 phone sync over SuperSync. Tasks the
 * phone adds to Today must reach the desktop and stay on the phone.
 * Runs the unmodified published bundles (scripts/fetch-released-client-assets.sh).
 */
test.describe('@supersync released mixed-version Today tasks (#10916)', () => {
  test.describe.configure({ mode: 'serial' });
  const releasedRoot = process.env.COMPAT_RELEASED_ROOT;
  test.skip(!releasedRoot, 'Set COMPAT_RELEASED_ROOT to the fetched released bundles');

  type Server = Awaited<ReturnType<typeof serveReleasedClientAssets>>;
  let v191: Server;
  let v192: Server;
  // No cookie serves v19.1.0; the cookie upgrades the origin in place.
  let upgradable: Server;
  // Entry scripts of each bundle, to prove which release a client booted.
  let entry191 = '';
  let entry192 = '';
  test.beforeAll(async () => {
    const d191 = `${releasedRoot}/v19.1.0`;
    const d192 = `${releasedRoot}/v19.2.0`;
    entry191 = await releasedEntryScript(d191);
    entry192 = await releasedEntryScript(d192);
    v191 = await serveReleasedClientAssets({ old: d191, new: d191 }, 0);
    v192 = await serveReleasedClientAssets({ old: d192, new: d192 }, 0);
    upgradable = await serveReleasedClientAssets({ old: d192, new: d191 }, 0);
  });
  test.afterAll(async () => {
    await Promise.all([v191?.close(), v192?.close(), upgradable?.close()]);
  });

  const addToday = async (client: SimulatedE2EClient, title: string): Promise<void> => {
    await client.page.goto('/#/tag/TODAY/tasks');
    await client.workView.waitForTaskList();
    await client.workView.addTask(`${title} @today`, false, title);
  };

  const todayTitles = async (client: SimulatedE2EClient): Promise<string[]> => {
    await client.page.goto('/#/tag/TODAY/tasks');
    await client.workView.waitForTaskList();
    return (await client.page.locator('task .task-title').allInnerTexts()).sort();
  };

  for (const upgraded of [false, true]) {
    test(`phone ${upgraded ? 'upgraded in place to' : 'on'} v19.2.0 keeps Today tasks with a v19.1.0 desktop`, async ({
      browser,
      testRunId,
    }) => {
      test.slow();
      const clients: SimulatedE2EClient[] = [];
      // addTask prefixes titles with `${clientName}-${testRunId}-`.
      const desk = (title: string): string => `Desk-${testRunId}-${title}`;
      const phoneTitle = (title: string): string => `Phone-${testRunId}-${title}`;
      try {
        const config = getSuperSyncConfig(await createTestUser(testRunId));
        const desktop = await createSimulatedClient(
          browser,
          v191.url,
          'Desk',
          testRunId,
          {
            serviceWorkers: 'block',
          },
        );
        clients.push(desktop);
        expect(await loadedEntryScript(desktop.page)).toBe(entry191);
        await desktop.sync.setupSuperSync(config);
        await addToday(desktop, 'Base');
        await desktop.sync.syncAndWait();

        const phone = await createSimulatedClient(
          browser,
          upgraded ? upgradable.url : v192.url,
          'Phone',
          testRunId,
          { serviceWorkers: 'block' },
        );
        clients.push(phone);
        await phone.sync.setupSuperSync(config);
        await phone.sync.syncAndWait();
        const expected = [desk('Base'), phoneTitle('A'), phoneTitle('B')];
        if (upgraded) {
          expect(await loadedEntryScript(phone.page)).toBe(entry191);
          await addToday(phone, 'Old');
          await phone.sync.syncAndWait();
          await desktop.sync.syncAndWait();
          await addToday(desktop, 'Two');
          await desktop.sync.syncAndWait();
          // Play auto-update: same origin and IndexedDB, newer bundle.
          await phone.context.addCookies([
            { name: 'compat-release', value: 'old', url: upgradable.url },
          ]);
          await phone.page.reload();
          await phone.sync.syncAndWait();
          expected.push(phoneTitle('Old'), desk('Two'));
        }
        expect(await loadedEntryScript(phone.page)).toBe(entry192);

        await addToday(phone, 'A');
        await addToday(phone, 'B');
        await phone.sync.syncAndWait();
        await desktop.sync.syncAndWait();
        await phone.sync.syncAndWait();

        expect(await todayTitles(desktop)).toEqual(expected.sort());
        expect(await todayTitles(phone)).toEqual(expected.sort());
      } finally {
        for (const client of clients) await closeClient(client);
      }
    });
  }
});
