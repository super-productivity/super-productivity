import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { expectNoGlobalError } from '../../utils/assertions';

test.describe('Project completion', () => {
  let projectPage: ProjectPage;
  let workViewPage: WorkViewPage;

  test.beforeEach(async ({ page, testPrefix }) => {
    projectPage = new ProjectPage(page, testPrefix);
    workViewPage = new WorkViewPage(page, testPrefix);
    await workViewPage.waitForTaskList();
  });

  test('complete a project and reopen it from archived projects', async ({ page }) => {
    // Arrange: a project with one done and one unfinished task
    await projectPage.createProject('Test Project');
    await projectPage.navigateToProjectByName('Test Project');
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Completion task 1', true);
    await workViewPage.addTask('Completion task 2');

    const firstTask = page.locator('task').first();
    await firstTask.hover();
    const doneBtn = firstTask.locator('done-toggle');
    await doneBtn.waitFor({ state: 'visible' });
    await doneBtn.click();

    // Act: complete the project from the sidebar context menu
    await projectPage.openProjectContextMenu('Test Project');
    await page
      .locator('.mat-mdc-menu-content button')
      .filter({ hasText: /complete project/i })
      .click();

    // The unfinished task triggers the resolve prompt → mark it done
    const resolveDialog = page.locator('dialog-complete-resolve-tasks');
    await expect(resolveDialog).toBeVisible();
    await resolveDialog.getByRole('button', { name: /mark as done/i }).click();

    // Confirm before final completion
    const confirmDialog = page.locator('dialog-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /complete project/i }).click();

    // Celebration dialog with stats
    const celebration = page.locator('dialog-project-complete');
    await expect(celebration).toBeVisible();
    const celebrationPanel = page.locator('.project-complete-fullscreen-dialog');
    await expect(celebrationPanel).toBeVisible();
    const panelBox = await celebrationPanel.boundingBox();
    const viewport = page.viewportSize();
    expect(panelBox?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) * 0.95);
    expect(panelBox?.height ?? 0).toBeGreaterThan((viewport?.height ?? 0) * 0.95);
    await expect(celebration.getByText(/project complete/i)).toBeVisible();
    await expect(celebration.getByText('Test Project')).toBeVisible();

    // Close the celebration and exercise the reactivation path.
    await celebration.locator('.actions button').click();
    await expect(celebration).toBeHidden();

    await page.goto('/#/archived-projects');
    const archivedProject = page
      .locator('archived-projects-page .project-row')
      .filter({ hasText: 'Test Project' });
    await expect(archivedProject).toBeVisible();

    await archivedProject.getByRole('button', { name: 'Reopen' }).click();

    await expect(archivedProject).toHaveCount(0);
    await projectPage.navigateToProjectByName('Test Project');
    await expect(page).toHaveURL(/\/#\/project\/.+\/tasks/);

    await expectNoGlobalError(page);
  });
});
