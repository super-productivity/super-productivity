import { expect, test } from '../../fixtures/test.fixture';
import { ProjectPage } from '../../pages/project.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { expectNoGlobalError } from '../../utils/assertions';

// #10944: the work view was painted over the archived notice, so only a thin
// band through the button's centre was clickable.
test.describe('Reopen archived project from its page', () => {
  test('reopens a completed project via the archived notice button', async ({
    page,
    testPrefix,
  }) => {
    const projectPage = new ProjectPage(page, testPrefix);
    const workViewPage = new WorkViewPage(page, testPrefix);
    await workViewPage.waitForTaskList();

    await projectPage.createProject('Reopen Details');
    await projectPage.navigateToProjectByName('Reopen Details');
    await workViewPage.waitForTaskList();

    await projectPage.openProjectContextMenu('Reopen Details');
    await page
      .locator('.mat-mdc-menu-content button')
      .filter({ hasText: /complete project/i })
      .click();
    const confirmDialog = page.locator('dialog-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /complete project/i }).click();
    const celebration = page.locator('dialog-project-complete');
    await expect(celebration).toBeVisible();
    await celebration.locator('.actions button').click();
    await expect(celebration).toBeHidden();

    await projectPage.archivedProjectsLink.click();
    await expect(page).toHaveURL(/\/#\/archived-projects$/);
    await projectPage
      .archivedProjectRow('Reopen Details')
      .locator('.project-link')
      .click();
    await expect(page).toHaveURL(/\/#\/project\/.+\/tasks/);

    const notice = page.locator('.archived-notice');
    await expect(notice).toContainText('This project is completed.');
    // Off-centre on purpose: the centre stayed clickable while the rest was covered.
    await notice
      .getByRole('button', { name: 'Reopen' })
      .click({ position: { x: 4, y: 4 }, timeout: 5000 });

    await expect(notice).toBeHidden();
    await expect(projectPage.archivedProjectsLink).toBeHidden();
    await expectNoGlobalError(page);
  });
});
