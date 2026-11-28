import { Page } from '@playwright/test';
import { expect, test as base } from '../../fixtures/test.fixture';
import { skipOnboardingForE2E, waitForAppReady } from '../../utils/waits';

// A task marked done during a Pomodoro break must stay done when the break ends.
// The clock is installed before the app loads so the break can be fast-forwarded.

type State = {
  tasks: {
    currentTaskId: string | null;
    entities: Record<string, { isDone: boolean }>;
  };
};
type TestWindow = Window & {
  __e2eTestHelpers: {
    store: {
      dispatch: (action: { type: string; [key: string]: unknown }) => void;
      subscribe: (fn: (state: State) => void) => { unsubscribe: () => void };
    };
  };
};
const test = base.extend({
  page: async ({ isolatedContext }, use) => {
    const page = await isolatedContext.newPage();
    await page.clock.install({ time: new Date('2026-10-23T10:00:00') });
    await page.addInitScript(skipOnboardingForE2E);
    await page.goto('/');
    await waitForAppReady(page);
    try {
      await use(page);
    } finally {
      await page.close();
    }
  },
});
const read = (page: Page): Promise<State> =>
  page.evaluate(() => {
    let state!: State;
    (window as unknown as TestWindow).__e2eTestHelpers.store
      .subscribe((s) => (state = s))
      .unsubscribe();
    return { tasks: state.tasks };
  });
const dispatch = (
  page: Page,
  action: { type: string; [key: string]: unknown },
): Promise<void> =>
  page.evaluate(
    (a) => (window as unknown as TestWindow).__e2eTestHelpers.store.dispatch(a),
    action,
  );
const startPomodoro = async (page: Page, duration = 60000): Promise<string> => {
  await page.waitForFunction(() => !!(window as unknown as TestWindow).__e2eTestHelpers);
  const id = Object.keys((await read(page)).tasks.entities)[0];
  await dispatch(page, { type: '[FocusMode] Show Overlay' });
  await page.locator('focus-mode-main').waitFor();
  await dispatch(page, { type: '[FocusMode] Set Mode', mode: 'Pomodoro' });
  await dispatch(page, { type: '[FocusMode] Start Session', duration, taskId: id });
  await expect.poll(async () => (await read(page)).tasks.currentTaskId).toBe(id);
  return id;
};

for (const ending of ['skip', 'complete']) {
  test(`a Pomodoro break ${ending === 'skip' ? 'skipped' : 'ended'} does not reopen a task completed during it`, async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Break task');
    const id = await startPomodoro(page);
    await page.clock.fastForward(61000);
    await expect(page.locator('focus-mode-break')).toBeVisible();
    await expect.poll(async () => (await read(page)).tasks.currentTaskId).toBeNull();
    await page.locator('focus-mode-overlay button.close-btn').click();
    await taskPage.markTaskAsDone(page.locator(`task[data-task-id="${id}"]`));
    expect((await read(page)).tasks.entities[id].isDone).toBe(true);
    await dispatch(page, { type: '[FocusMode] Show Overlay' });
    if (ending === 'complete') {
      await page.clock.fastForward(301000);
      await page
        .getByRole('button', { name: 'Start next focus session', exact: true })
        .click();
    } else {
      await page.getByRole('button', { name: 'Skip break', exact: true }).click();
    }
    await expect
      .poll(async () => (await read(page)).tasks.entities[id].isDone)
      .toBe(true);
    expect((await read(page)).tasks.currentTaskId).toBeNull();
    await page.reload();
    await workViewPage.waitForTaskList();
    await expect
      .poll(async () => (await read(page)).tasks.entities[id].isDone)
      .toBe(true);
  });
}
