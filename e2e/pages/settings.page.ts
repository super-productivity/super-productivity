import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { cssSelectors } from '../constants/selectors';
import { waitForAngularStability } from '../utils/waits';

const { SETTINGS_BTN, PAGE_SETTINGS } = cssSelectors;

export class SettingsPage extends BasePage {
  readonly settingsBtn: Locator;
  readonly pageSettings: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);

    this.settingsBtn = page.locator(SETTINGS_BTN);
    this.pageSettings = page.locator(PAGE_SETTINGS);
  }

  /**
   * Navigate to settings page
   */
  async navigateToSettings(): Promise<void> {
    await this.settingsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await this.settingsBtn.click();
    await this.pageSettings.waitFor({ state: 'visible', timeout: 10000 });
    await waitForAngularStability(this.page);
  }

  /**
   * Expand a collapsible section by scrolling to it and clicking header
   */
  async expandSection(sectionSelector: string): Promise<void> {
    const section = this.page.locator(sectionSelector);
    await section.scrollIntoViewIfNeeded();

    const collapsible = section.locator('collapsible');
    const isExpanded = await collapsible.evaluate((el) =>
      el.classList.contains('isExpanded'),
    );

    if (!isExpanded) {
      const header = collapsible.locator('.collapsible-header');
      await header.click();
      // Wait for expansion - panel only exists when expanded (@if in template)
      await collapsible
        .locator('.collapsible-panel')
        .waitFor({ state: 'visible', timeout: 5000 });
    }

    await waitForAngularStability(this.page);
  }

  /**
   * Scroll to a specific section
   */
  async scrollToSection(sectionSelector: string): Promise<void> {
    await this.page.evaluate((selector) => {
      const section = document.querySelector(selector);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, sectionSelector);
    await this.page.waitForTimeout(500);
  }

  /**
   * Check if on settings page
   */
  async isOnSettingsPage(): Promise<boolean> {
    return await this.pageSettings.isVisible();
  }

  /**
   * Navigate back to work view
   */
  async navigateBackToWorkView(): Promise<void> {
    await this.page.goto('/#/tag/TODAY/tasks');
    await this.page.waitForLoadState('networkidle');
    await waitForAngularStability(this.page);
  }
}
