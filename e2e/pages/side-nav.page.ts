import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class SideNavPage extends BasePage {
  readonly nav: Locator;
  readonly navItems: Locator;
  readonly allProjectsBtn: Locator;
  readonly backlogTasksBtn: Locator;
  readonly doneTasksBtn: Locator;
  readonly settingsBtn: Locator;
  readonly projectsGroupHeader: Locator;
  readonly projectsGroupAdditionalBtn: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);
    this.nav = page.locator('magic-side-nav');
    this.navItems = page.locator('magic-side-nav nav-item');
    this.allProjectsBtn = page.locator('magic-side-nav button:has-text("All Projects")');
    this.backlogTasksBtn = page.locator('magic-side-nav button:has-text("Backlog")');
    this.doneTasksBtn = page.locator('magic-side-nav button:has-text("Done")');
    this.settingsBtn = page.locator('magic-side-nav button[routerlink="/settings"]');
    this.projectsGroupHeader = page
      .locator('.g-multi-btn-wrapper')
      .filter({ hasText: 'Projects' })
      .first();
    this.projectsGroupAdditionalBtn = this.projectsGroupHeader.locator('.additional-btn');
  }

  async ensureSideNavOpen(): Promise<void> {
    const isVisible = await this.nav.isVisible();
    if (!isVisible) {
      // Click somewhere on the main content to unfocus if side nav might be closed
      await this.page.locator('body').click();
      await this.page.waitForTimeout(500); // give it a moment
      // Attempt to open side nav via a common trigger if it's not visible
      const menuBtn = this.page.locator('#triggerSideNavBtn');
      if (await menuBtn.isVisible()) {
        await menuBtn.click();
        await this.nav.waitFor({ state: 'visible', timeout: 5000 });
      } else {
        // Fallback: if there's no specific menu button, assume some key press might work or it's a layout issue
        // For now, if no button, just throw or log a warning if side nav is critical
        throw new Error('Side nav is not visible and no trigger button found');
      }
    }
    // Ensure the side nav is fully rendered and stable
    await this.navItems.first().waitFor({ state: 'visible', timeout: 5000 });
  }

  async ensureSideNavClosed(): Promise<void> {
    const isVisible = await this.nav.isVisible();
    if (isVisible) {
      // Click outside to close side nav
      await this.page.locator('body').click({ position: { x: 500, y: 500 } });
      await this.nav.waitFor({ state: 'hidden', timeout: 5000 });
    }
  }

  async ensureProjectsGroupExpanded(): Promise<void> {
    const isExpanded = await this.projectsGroupAdditionalBtn.isVisible(); // The additional button is only visible when expanded
    if (!isExpanded) {
      // Click the header to expand
      await this.projectsGroupHeader.click();
      // Wait for the additional button to become visible, indicating expansion
      await this.projectsGroupAdditionalBtn.waitFor({ state: 'visible', timeout: 8000 });
    }
  }
}
