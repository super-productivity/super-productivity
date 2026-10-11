import { expect, test } from '../../fixtures/test.fixture';
import type { Page } from '@playwright/test';
import { expectNoGlobalError } from '../../utils/assertions';

/**
 * #10024: with issue auto-create enabled, adding a task whose title carries
 * short syntax ("Write report #work @tomorrow") raced the auto-create effect
 * against the short-syntax effect. The issue was created FROM the raw title
 * (tokens included), and the issue-number write-back then overwrote the
 * locally cleaned title with the raw one.
 *
 * Unlike the unit specs (which subscribe to the auto-create effect alone and
 * mock task reads/writes), this runs the real path — both effects and the
 * real reducer — and holds the create response until short syntax has landed
 * locally, which is exactly the reported timing.
 *
 * The add-task bar runs its own async short-syntax parse and would often
 * dispatch the already-cleaned title, hiding the effect-level race. We hold
 * the lazy date-parser module (imported on the first date-token parse)
 * until after the task is added, so the action carries the RAW title — the
 * exact input from the report — and assert the raw title landed before
 * letting the parse proceed. The hold matches the parser chunk by name in
 * dev and falls back to same-origin lazy chunks for CI's built app.
 */
type TaskSnapshot = {
  title: string;
  dueDay: string | null;
  tagTitles: string[];
} | null;

const getTaskSnapshot = async (page: Page, title: string): Promise<TaskSnapshot> =>
  page.evaluate((needle) => {
    type TaskLike = {
      title?: string;
      dueDay?: string | null;
      tagIds?: string[];
    };
    type TagLike = { id?: string; title?: string };
    type StoreState = {
      tasks?: { entities?: Record<string, TaskLike | undefined> };
      tag?: { entities?: Record<string, TagLike | undefined> };
    };
    type StoreSubscription = { unsubscribe: () => void };
    type StoreLike = {
      subscribe: (next: (state: StoreState) => void) => StoreSubscription;
    };

    const helpers = (window as unknown as { __e2eTestHelpers?: { store?: StoreLike } })
      .__e2eTestHelpers;
    if (!helpers?.store) {
      throw new Error('__e2eTestHelpers.store missing');
    }
    let latestState: StoreState | undefined;
    helpers.store
      .subscribe((state) => {
        latestState = state;
      })
      .unsubscribe();

    const task = Object.values(latestState?.tasks?.entities ?? {}).find((candidate) =>
      candidate?.title?.includes(needle),
    );
    if (!task) {
      return null;
    }
    const tagsById = latestState?.tag?.entities ?? {};
    return {
      title: task.title ?? '',
      dueDay: task.dueDay ?? null,
      tagTitles: (task.tagIds ?? [])
        .map((id) => tagsById[id]?.title)
        .filter((t): t is string => !!t),
    };
  }, title);

/** Tomorrow as a db date string, resolved on the app's clock (see #10024 rollover note). */
const getTomorrowDbDate = async (page: Page): Promise<string> =>
  page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  });

test('auto-created issue excludes short syntax tokens (#10024)', async ({
  page,
  workViewPage,
  projectPage,
  tagPage,
  testPrefix,
}) => {
  await workViewPage.waitForTaskList();
  await projectPage.createAndGoToTestProject();
  // An existing tag keeps the short-syntax effect from opening its
  // new-tag confirmation dialog mid-race.
  await tagPage.createTag('work');

  const projectName = `${testPrefix}-Test Project`;
  const cleanTitle = `${testPrefix}-Write report`;

  // The auto-create effect must not see the raw title, and the write-back
  // must not clobber the cleaned one. Hold the create response until short
  // syntax has landed on the task.
  let outgoingCreateTitle: string | null = null;
  let releaseCreate!: () => void;
  const createReleased = new Promise<void>((resolve): void => {
    releaseCreate = resolve;
  });

  const mkIssue = (title: string): Record<string, unknown> => ({
    id: 42,
    number: 42,
    title,
    body: 'Issue body',
    state: 'open',
    html_url: 'https://github.com/e2e/repro/issues/42',
    created_at: '2026-01-01T12:00:00Z',
    updated_at: '2026-01-01T12:00:00Z',
    comments: 0,
    labels: [],
  });

  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    const isCreate =
      route.request().method() === 'POST' && /\/repos\/e2e\/repro\/issues\/?$/.test(url);
    if (isCreate) {
      outgoingCreateTitle =
        (route.request().postDataJSON() as { title?: string })?.title ?? null;
      await createReleased;
      await route.fulfill({ json: mkIssue(cleanTitle) });
      return;
    }
    await route.fulfill({
      json: url.includes('/search/issues') ? { items: [] } : mkIssue(cleanTitle),
    });
  });

  // Configure GitHub Issues with auto-create bound to the test project
  await page.locator('.e2e-toggle-issue-provider-panel').click();
  await page.locator('mat-tab-group .mat-mdc-tab:last-child').click();
  await page.getByRole('button', { name: 'GitHub Issues', exact: true }).click();
  const dialog = page.locator('dialog-edit-issue-provider');
  await dialog.locator('input[id*="repo"]').fill('e2e/repro');
  await dialog.locator('input[id*="token"]').fill('e2e-token');

  await dialog.getByRole('button', { name: /Advanced Config/i }).click();
  await dialog.locator('mat-select[id*="defaultProjectId"]').click();
  await page.getByRole('option', { name: projectName }).click();

  await dialog.getByRole('button', { name: /Two-Way Sync/i }).click();
  await dialog.locator('mat-checkbox[id*="isAutoCreateIssues"]').click();

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.e2e-toggle-issue-provider-panel').click();

  // Hold the date parser's lazy chunk (see file comment) so the dispatched
  // action carries the raw title. CI serves the built app, whose lazy chunks
  // are `chunk-<hash>.js`, so the parser cannot be matched by name there:
  // hold every same-origin lazy-chunk request instead. Registered only once
  // the provider dialog is closed — at that point the parser's chunk is the
  // only dynamic import left to happen, because none of the setup titles
  // carried date syntax to load it earlier.
  let releaseChrono!: () => void;
  const chronoReleased = new Promise<void>((resolve): void => {
    releaseChrono = resolve;
  });
  const appOrigin = new URL(page.url()).origin;
  await page.route(
    (url): boolean =>
      url.origin === appOrigin &&
      (url.href.includes('chrono') || /(^|\/)chunk-[^/]+\.m?js$/.test(url.pathname)),
    async (route) => {
      await chronoReleased;
      await route.continue();
    },
  );

  // The reported case: raw tokens in the title of an auto-created task
  const tomorrowBeforeAdd = await getTomorrowDbDate(page);
  await workViewPage.addTask('Write report #work @tomorrow', false, null);
  // The hold must actually gate the parse — in dev AND built assets. If it
  // did not, the add-task bar's parse would have dispatched the cleaned
  // title and the rest would pass trivially, so prove the raw title is on
  // the task before letting parsing proceed.
  const rawTitle = `${testPrefix}-Write report #work @tomorrow`;
  await expect
    .poll(async () => (await getTaskSnapshot(page, cleanTitle))?.title ?? null)
    .toBe(rawTitle);
  releaseChrono();

  // Short syntax lands locally while the create response is held — the exact
  // race from the report. The task title must lose both tokens.
  await expect
    .poll(async () => (await getTaskSnapshot(page, cleanTitle))?.title ?? null)
    .toBe(cleanTitle);
  releaseCreate();

  // Write-back prefixes the issue number once the create resolves
  await expect
    .poll(async () => (await getTaskSnapshot(page, cleanTitle))?.title ?? null)
    .toMatch(/^#42 /);

  const task = await getTaskSnapshot(page, cleanTitle);
  expect(task).not.toBeNull();
  // The outgoing issue never carried the tokens
  expect(outgoingCreateTitle).toBe(cleanTitle);
  // And the write-back kept the locally cleaned title
  expect(task!.title).toBe(`#42 ${cleanTitle}`);
  // Short syntax side effects survived the round trip
  expect(task!.tagTitles).toContain('work');
  const tomorrowAfterAssert = await getTomorrowDbDate(page);
  expect([tomorrowBeforeAdd, tomorrowAfterAssert]).toContain(task!.dueDay);

  await expectNoGlobalError(page);
});
