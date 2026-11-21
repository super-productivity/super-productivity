import { test, expect } from '../../fixtures/test.fixture';
import { WorkViewPage } from '../../pages/work-view.page';

for (const interfaceDirection of ['ltr', 'rtl']) {
  test(`detects task text direction in an ${interfaceDirection} interface`, async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();
    // Keep both shell direction sources consistent, as AppComponent does.
    await page.evaluate((dir) => {
      document.dir = dir;
      document.querySelector('.app-container')!.setAttribute('dir', dir);
    }, interfaceDirection);

    const title = 'Docker را بررسی کن https://example.com';
    // Keep the title exact for the read/edit assertions.
    await new WorkViewPage(page).addTask(title);
    const task = page.locator('task').first();
    await expect(task).toContainText(title);
    const display = task.locator('task-title .display-value');
    await expect(display).toHaveCSS('direction', 'rtl');
    await expect(display.locator('a')).toHaveAttribute('href', 'https://example.com');
    await task.locator('task-title').click();
    const editor = task.locator('task-title textarea');
    const measure = task.locator('task-title .height-measure');
    await expect(editor).toHaveCSS('direction', 'rtl');
    await expect(measure).toHaveCSS('direction', 'rtl');

    await editor.fill('Review گزارش');
    await expect(editor).toHaveCSS('direction', 'rtl');
    await expect(measure).toHaveCSS('direction', 'rtl');
    await editor.fill('Review report');
    await expect(editor).toHaveCSS('direction', 'ltr');
    await expect(measure).toHaveCSS('direction', 'ltr');
    await editor.press('Tab');
    await expect(display).toHaveText('Review report');
    await expect(display).toHaveCSS('direction', 'ltr');
    await expect(page.locator('.app-container')).toHaveAttribute(
      'dir',
      interfaceDirection,
    );
  });
}

test('keeps the add-task highlight mirror aligned as Arabic letters are added and removed', async ({
  page,
  workViewPage,
}) => {
  await workViewPage.waitForTaskList();
  // Opening the bar through the page object also exercises normal task creation.
  await workViewPage.addTask('Initial task');
  await page.locator('.tour-addBtn').click();
  const input = page.locator('add-task-bar textarea.main-input').first();
  await expect(input).toBeVisible();
  const mirror = page.locator('add-task-bar .main-input-highlight').first();
  await input.fill('Review گزارش #کار\nReview report');
  await expect(input).toHaveCSS('direction', 'rtl');
  await expect(mirror).toHaveCSS('direction', 'rtl');
  await expect(input).toHaveCSS('unicode-bidi', 'isolate');
  await expect(mirror).toHaveCSS('unicode-bidi', 'isolate');
  await expect(input).toHaveCSS('text-align', 'start');
  await expect(mirror).toHaveCSS('text-align', 'start');
  await input.fill('Review گزارش #work');
  await expect(input).toHaveCSS('direction', 'rtl');
  await expect(mirror).toHaveCSS('direction', 'rtl');
  await input.fill('Review report #work');
  await expect(input).toHaveCSS('direction', 'ltr');
  await expect(mirror).toHaveCSS('direction', 'ltr');
});

test('renders mixed directions in a 500-task list', async ({
  page,
  workViewPage,
  projectPage,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createProject('Direction scale');
  await projectPage.navigateToProjectByName('Direction scale');
  await workViewPage.addTask('Direction seed');
  await page.evaluate(async () => {
    type TaskLike = { id: string; projectId: string; title: string };
    type State = { tasks: { entities: Record<string, TaskLike> } };
    const store = (
      window as unknown as {
        __e2eTestHelpers: {
          store: {
            subscribe: (next: (s: State) => void) => { unsubscribe: () => void };
            dispatch: (action: unknown) => void;
          };
        };
      }
    ).__e2eTestHelpers.store;
    let seed!: TaskLike;
    store
      .subscribe((state) => {
        seed = Object.values(state.tasks.entities).find((task) =>
          task.title.endsWith('Direction seed'),
        )!;
      })
      .unsubscribe();
    for (let i = 0; i < 499; i++) {
      const id = 'direction-scale-' + i;
      store.dispatch({
        type: '[Task Shared] addTask',
        task: { ...seed, id, title: i % 2 ? 'English ' + i : 'Docker فارسی ' + i },
        workContextId: seed.projectId,
        workContextType: 'PROJECT',
        isAddToBacklog: false,
        isAddToBottom: true,
        meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'CRT' },
      });
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  await expect(page.locator('task')).toHaveCount(500);
  await expect
    .poll(() =>
      page.locator('task-title .display-value').evaluateAll((titles) => {
        const directions = titles.map((title) => getComputedStyle(title).direction);
        return {
          rtl: directions.filter((direction) => direction === 'rtl').length,
          ltr: directions.filter((direction) => direction === 'ltr').length,
        };
      }),
    )
    .toEqual({ rtl: 250, ltr: 250 });
});
