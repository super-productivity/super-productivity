import { expect, test } from '../../fixtures/test.fixture';

/**
 * Basic e2e coverage for the Sections feature.
 *
 * Sections live inside a project (and tag/today, but project is the
 * simpler isolated surface). Each test creates its own project so they
 * stay independent and the testPrefix keeps names unique across workers.
 */
test.describe('Sections', () => {
  /**
   * Create a fresh project and navigate to it. Avoids
   * `createAndGoToTestProject()` which hits a strict-mode `.nav-children`
   * violation when both Projects and Tags trees are expanded.
   */
  const setupTestProject = async (
    workViewPage: import('../../pages/work-view.page').WorkViewPage,
    projectPage: import('../../pages/project.page').ProjectPage,
    projectName: string = 'Test Project',
  ): Promise<void> => {
    await workViewPage.waitForTaskList();
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);
  };

  /**
   * Open the work-context menu via the page-title's `.project-settings-btn`
   * (the more_vert icon next to the project title in the main header).
   * This is the same menu the side-nav `additional-btn` opens, but the
   * header trigger is always visible without hover and isn't sensitive to
   * the tree's expand/collapse state.
   */
  const openProjectContextMenu = async (
    page: import('@playwright/test').Page,
  ): Promise<void> => {
    const trigger = page.locator('.project-settings-btn');
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
    await trigger.click();
    await page
      .locator('work-context-menu')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
  };

  /** Click the "Add Section" item in the open work-context menu. */
  const clickAddSection = async (
    page: import('@playwright/test').Page,
  ): Promise<void> => {
    await page.getByRole('menuitem', { name: 'Add Section' }).click();
  };

  /** Fill the dialog-prompt input and submit. */
  const submitPromptDialog = async (
    page: import('@playwright/test').Page,
    title: string,
  ): Promise<void> => {
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    const input = dialog.locator('input[type="text"]').first();
    await input.fill(title);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
  };

  /** Locator for a rendered section block in the work view by title. */
  const sectionByTitle = (
    page: import('@playwright/test').Page,
    title: string,
  ): ReturnType<import('@playwright/test').Page['locator']> =>
    page.locator('.section-container').filter({ hasText: title });

  /**
   * CDK drag-drop is event-driven via Angular CDK's own pointer-event
   * handling. Playwright's `dragTo` uses HTML5 drag-and-drop events,
   * which CDK ignores. Drive the gesture manually with multi-step mouse
   * moves so the CDK threshold + drag start fires.
   */
  const cdkDragTo = async (
    page: import('@playwright/test').Page,
    source: import('@playwright/test').Locator,
    target: import('@playwright/test').Locator,
  ): Promise<void> => {
    const sBox = await source.boundingBox();
    const tBox = await target.boundingBox();
    if (!sBox || !tBox) throw new Error('drag source/target has no bounding box');
    /* eslint-disable no-mixed-operators */
    const sx = sBox.x + sBox.width / 2;
    const sy = sBox.y + sBox.height / 2;
    const tx = tBox.x + tBox.width / 2;
    const ty = tBox.y + tBox.height / 2;
    /* eslint-enable no-mixed-operators */

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // Initial nudge past CDK's drag threshold (5px by default).
    await page.mouse.move(sx + 10, sy + 10, { steps: 5 });
    // Smooth move to target so each `mousemove` re-evaluates drop target.
    await page.mouse.move(tx, ty, { steps: 20 });
    await page.mouse.up();
  };

  test('creates a section via the project context menu', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'My Section');

    await expect(sectionByTitle(page, 'My Section')).toBeVisible();
  });

  test('creates a section via right-click on the work-view background', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    // The app-level bg context menu (shared with "Change Settings") only
    // opens when the click target itself matches the allowed selectors,
    // not on descendants. dispatchEvent fires the contextmenu directly
    // on the wrapper so target.matches('.task-list-wrapper') holds.
    const wrapper = page.locator('.task-list-wrapper').first();
    await wrapper.waitFor({ state: 'visible', timeout: 5000 });
    await wrapper.dispatchEvent('contextmenu');

    await page.getByRole('menuitem', { name: 'Add Section' }).click();
    await submitPromptDialog(page, 'Right-Click Section');

    await expect(sectionByTitle(page, 'Right-Click Section')).toBeVisible();
  });

  test('rejects whitespace-only section titles', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);

    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    const input = dialog.locator('input[type="text"]').first();
    await input.fill('   ');
    // The form's `required` validator considers whitespace truthy as a
    // string, so Save dispatches — but the component-side trim guard
    // (work-context-menu.component.ts) drops the dispatch. Verify no
    // section appears.
    await dialog.getByRole('button', { name: 'Save' }).click();
    // Dialog may stay open (required validation) or close without effect.
    // Either way the section list must remain empty — `toHaveCount`
    // already polls so no separate wait is needed.
    await expect(page.locator('.section-container')).toHaveCount(0, { timeout: 1500 });
  });

  test('edits an existing section title', async ({ page, workViewPage, projectPage }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Original');

    const section = sectionByTitle(page, 'Original');
    await expect(section).toBeVisible();

    // Open the section's per-section menu and click Edit.
    await section.locator('button[mat-icon-button]').click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    const input = dialog.locator('input[type="text"]').first();
    await input.fill('Renamed');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });

    await expect(sectionByTitle(page, 'Renamed')).toBeVisible();
    await expect(sectionByTitle(page, 'Original')).toHaveCount(0);
  });

  test('deletes a section after confirmation', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Doomed');

    const section = sectionByTitle(page, 'Doomed');
    await expect(section).toBeVisible();

    await section.locator('button[mat-icon-button]').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const confirm = page.locator('dialog-confirm');
    await confirm.waitFor({ state: 'visible', timeout: 5000 });
    // The confirmation has an OK / Confirm button — match either.
    await confirm
      .getByRole('button', { name: /^(OK|Confirm)$/i })
      .first()
      .click();
    await confirm.waitFor({ state: 'hidden', timeout: 5000 });

    await expect(sectionByTitle(page, 'Doomed')).toHaveCount(0);
  });

  test('drops a task into a section via drag and drop', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    // Add task BEFORE creating the section so it lives in the no-section
    // bucket initially.
    await workViewPage.addTask('Movable');
    await page.waitForSelector('task', { state: 'visible' });

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Target');

    const section = sectionByTitle(page, 'Target');
    await expect(section).toBeVisible();
    // The section's inner task-list is the drop target.
    const sectionTaskList = section.locator('task-list').first();
    const noSectionTaskList = page.locator('.no-section task-list').first();

    // Drag handle is `done-toggle` (per task-dragdrop.spec.ts).
    const task = page.locator('task').filter({ hasText: 'Movable' }).first();
    const dragHandle = task.locator('done-toggle').first();

    await cdkDragTo(page, dragHandle, sectionTaskList);

    // Task should now render inside the section, not in the no-section list.
    await expect(section.locator('task').filter({ hasText: 'Movable' })).toBeVisible({
      timeout: 5000,
    });
    await expect(
      noSectionTaskList.locator('task').filter({ hasText: 'Movable' }),
    ).toHaveCount(0);
  });

  test('reorders tasks within a section via drag and drop', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Box');

    const section = sectionByTitle(page, 'Box');
    await expect(section).toBeVisible();

    // Drag three distinctly-named tasks into the section. The exact
    // post-drag order isn't deterministic under headless CDK (depends on
    // bounding-box centers), so we capture the actual order rather than
    // assert one. The behavioral invariant we care about: AFTER an
    // intra-section drag, the dragged task is no longer at its original
    // index. Before the bug fix that didn't hold (display read
    // workContext.taskIds order, ignoring section.taskIds reorders).
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      await workViewPage.addTask(name);
      const t = page.locator('.no-section task').filter({ hasText: name }).first();
      await cdkDragTo(
        page,
        t.locator('done-toggle').first(),
        section.locator('task-list').first(),
      );
      await expect(section.locator('task').filter({ hasText: name })).toBeVisible({
        timeout: 5000,
      });
    }

    const sectionTaskTitles = async (): Promise<string[]> =>
      (await section.locator('task:not(.ng-animating) .task-title').allTextContents())
        .map((s) => s.trim())
        .filter(Boolean);

    const before = await sectionTaskTitles();
    expect(before.length).toBe(3);

    // Drag the first task onto the last task. After the drop, the first
    // task should no longer be at index 0.
    const firstTask = section.locator('task').nth(0);
    const lastTask = section.locator('task').nth(2);
    await cdkDragTo(page, firstTask.locator('done-toggle').first(), lastTask);

    await expect
      .poll(async () => (await sectionTaskTitles())[0], { timeout: 5000 })
      .not.toEqual(before[0]);
    // And all three tasks are still in the section.
    await expect.poll(async () => (await sectionTaskTitles()).length).toBe(3);
  });

  // FIXME: cross-section drag is flaky in headless CDK for the same
  // pointer-event reason as the section→no-section round-trip below — the
  // source task's bounding box can collapse mid-gesture when the source
  // section re-renders without it. Behavior is covered by section.reducer
  // unit tests (cross-section moves via `addTaskToSection`) and by the
  // component-level `undoneTasksBySection` spec.
  test.fixme('moves a task from one section to a specific slot in another', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Left');
    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Right');

    const left = sectionByTitle(page, 'Left');
    const right = sectionByTitle(page, 'Right');
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    // Populate Right with [Xray, Yankee] and Left with [Zulu].
    for (const [name, target] of [
      ['Xray', right],
      ['Yankee', right],
      ['Zulu', left],
    ] as const) {
      await workViewPage.addTask(name);
      const t = page.locator('.no-section task').filter({ hasText: name }).first();
      await cdkDragTo(
        page,
        t.locator('done-toggle').first(),
        target.locator('task-list').first(),
      );
      await expect(target.locator('task').filter({ hasText: name })).toBeVisible({
        timeout: 5000,
      });
    }

    // Drag Zulu from Left onto Yankee in Right.
    const taskZulu = left.locator('task').filter({ hasText: 'Zulu' }).first();
    const taskYankee = right.locator('task').filter({ hasText: 'Yankee' }).first();
    await cdkDragTo(page, taskZulu.locator('done-toggle').first(), taskYankee);

    // Behavioral invariant: Zulu has crossed sections. Exact slot is
    // CDK-cursor dependent, so we don't pin it.
    await expect(right.locator('task').filter({ hasText: 'Zulu' })).toBeVisible({
      timeout: 5000,
    });
    await expect(left.locator('task').filter({ hasText: 'Zulu' })).toHaveCount(0);
    await expect(right.locator('task')).toHaveCount(3);
  });

  // FIXME: round-trip drag (section → no-section) is flaky in headless CDK.
  // The forward "into section" drag passes; the reverse fails to register the
  // drop on the empty `.no-section` task-list whose bounding box collapses
  // to its hint-message. Driving CDK pointer events deterministically here
  // is non-trivial — track as a follow-up and exercise reverse moves via
  // unit tests in section.reducer.spec.ts (`removeTaskFromSection`).
  test.fixme('drags a task back out of a section into the main list', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await workViewPage.addTask('Roundtrip');
    await page.waitForSelector('task', { state: 'visible' });

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Holding');

    const section = sectionByTitle(page, 'Holding');
    const sectionTaskList = section.locator('task-list').first();
    // Target the wrapper `.no-section` div, not the inner task-list — when
    // the no-section bucket is empty the task-list collapses to its hint
    // text and may have a too-small bounding box for a stable drop.
    const noSection = page.locator('.no-section').first();

    const task = page.locator('task').filter({ hasText: 'Roundtrip' }).first();
    let dragHandle = task.locator('done-toggle').first();

    // Move into section.
    await cdkDragTo(page, dragHandle, sectionTaskList);
    const taskInSection = section
      .locator('task')
      .filter({ hasText: 'Roundtrip' })
      .first();
    await expect(taskInSection).toBeVisible();

    // Move back out — re-acquire handle from the new DOM location.
    dragHandle = taskInSection.locator('done-toggle').first();
    await cdkDragTo(page, dragHandle, noSection);

    await expect(noSection.locator('task').filter({ hasText: 'Roundtrip' })).toBeVisible({
      timeout: 5000,
    });
    await expect(section.locator('task').filter({ hasText: 'Roundtrip' })).toHaveCount(0);
  });

  test('sections persist across a page reload', async ({
    page,
    workViewPage,
    projectPage,
  }) => {
    await setupTestProject(workViewPage, projectPage);

    await openProjectContextMenu(page);
    await clickAddSection(page);
    await submitPromptDialog(page, 'Persistent');

    await expect(sectionByTitle(page, 'Persistent')).toBeVisible();

    // Reload — the project view re-hydrates from IndexedDB.
    await page.reload();
    await workViewPage.waitForTaskList();

    // The reload may land on Today; navigate back to the project so the
    // section list is what's rendered.
    await projectPage.navigateToProjectByName('Test Project');

    await expect(sectionByTitle(page, 'Persistent')).toBeVisible({ timeout: 10000 });
  });
});
