import { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/test.fixture';
import {
  addPlainspaceProvider,
  FakePlainspace,
  installFakePlainspace,
} from '../../utils/plainspace-fake';

// The update poll (pull of remote changes, also on focus for Plainspace) must
// run without the user ever switching project or tag. It used to start only
// on the first context switch or `loadAllData` of a session, and a session
// that stays on Today after a boot that replays the op log dispatches neither.

const TASK_ID = 'task-1';

/** Titles of the tasks linked to Plainspace's TASK_ID, from the live store. */
const linkedTitle = (page: Page): Promise<string | undefined> =>
  page.evaluate(async (issueId) => {
    type StoreLike = {
      subscribe: (next: (state: unknown) => void) => { unsubscribe: () => void };
    };
    interface TaskLike {
      title: string;
      issueId?: string;
    }
    const store = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers?.store;
    if (!store) {
      return undefined;
    }
    const state = await new Promise<{
      tasks?: { entities?: Record<string, TaskLike | undefined> };
    }>((resolve) => {
      const sub = store.subscribe((s) => {
        resolve(s as { tasks?: { entities?: Record<string, TaskLike | undefined> } });
        setTimeout(() => sub.unsubscribe());
      });
    });
    return Object.values(state.tasks?.entities ?? {}).find((t) => t?.issueId === issueId)
      ?.title;
  }, TASK_ID);

/**
 * A fresh install binds Plainspace to the Inbox from Today, without opening
 * any project, and waits until the assigned task is imported.
 */
const setUpOnToday = async (page: Page): Promise<FakePlainspace> => {
  const server = await installFakePlainspace(page);
  server.addAssignedTask(TASK_ID, 'Buy tent');
  await addPlainspaceProvider(page, /Inbox/);
  await expect.poll(() => linkedTitle(page), { timeout: 30000 }).toBe('Buy tent');
  expect(page.url()).toContain('/tag/TODAY/');
  return server;
};

test.describe('Plainspace update poll starts without a context switch', () => {
  test.setTimeout(120000);

  test('looking at the app pulls a collaborator change', async ({
    page,
    workViewPage,
  }) => {
    let updatePolls = 0;
    page.on('console', (msg) => {
      if (msg.text().includes('POLLING CHANGES FOR PLAINSPACE')) {
        updatePolls++;
      }
    });
    await workViewPage.waitForTaskList();
    const server = await setUpOnToday(page);
    // Deliberate: let the timer's first poll (8 s after start) pass; the next
    // one is minutes away, so a pull right after the focus is the focus's own.
    await page.waitForTimeout(10000);

    server.remoteEdit(TASK_ID, { title: 'Buy big tent' });
    const before = updatePolls;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect.poll(() => updatePolls, { timeout: 5000 }).toBeGreaterThan(before);
    await expect.poll(() => linkedTitle(page), { timeout: 5000 }).toBe('Buy big tent');
  });

  test('the poll after a restart pulls a collaborator change', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    const server = await setUpOnToday(page);

    server.remoteEdit(TASK_ID, { title: 'Buy big tent' });
    await page.reload();
    await workViewPage.waitForTaskList();

    // The update poll runs 8 s after start.
    await expect.poll(() => linkedTitle(page), { timeout: 30000 }).toBe('Buy big tent');
  });
});
