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

  test('complete a project, see the celebration, then reopen it', async ({ page }) => {
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
    await expect(celebration.getByText(/project complete/i)).toBeVisible();
    await expect(celebration.getByText('Test Project')).toBeVisible();

    // "View completed projects" navigates to the archived/completed page
    await celebration.getByRole('button', { name: /view completed projects/i }).click();
    await expect(page).toHaveURL(/archived-projects/);

    // The project shows there with a trophy badge and a Reopen action
    const projectRow = page.locator('.project-row').filter({ hasText: 'Test Project' });
    await expect(projectRow).toBeVisible();
    await expect(projectRow.locator('.completed-badge')).toBeVisible();

    // Reopen → the project leaves the completed list
    await projectRow.getByRole('button', { name: /reopen/i }).click();
    await expect(projectRow).toBeHidden();

    await expectNoGlobalError(page);
  });
});
