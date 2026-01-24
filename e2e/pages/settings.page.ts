import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { cssSelectors } from '../constants/selectors';
import { waitForAngularStability } from '../utils/waits';

const {
  SETTINGS_BTN,
  PAGE_SETTINGS,
  PLUGIN_SECTION,
  PLUGIN_MANAGEMENT,
  PLUGIN_CARD,
  PLUGIN_TOGGLE,
  PLUGIN_FILE_INPUT,
} = cssSelectors;

export class SettingsPage extends BasePage {
  readonly settingsBtn: Locator;
  readonly pageSettings: Locator;
  readonly pluginSection: Locator;
  readonly pluginManagement: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);

    this.settingsBtn = page.locator(SETTINGS_BTN);
    this.pageSettings = page.locator(PAGE_SETTINGS);
    this.pluginSection = page.locator(PLUGIN_SECTION);
    this.pluginManagement = page.locator(PLUGIN_MANAGEMENT);
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
   * Expand plugin section
   * Note: The plugin section is now in the "Plugins" tab (4th tab, index 3)
   */
  async expandPluginSection(): Promise<void> {
    // The plugin section is now in the "Plugins" tab (4th tab, index 3)
    // Click on the "Plugins" tab to navigate to it
    const pluginsTab = this.page.locator(
      'mat-tab-header .mat-mdc-tab:has(mat-icon:has-text("extension"))',
    );
    await pluginsTab.waitFor({ state: 'visible', timeout: 10000 });
    await pluginsTab.click();
    await this.page.waitForTimeout(500);

    // Ensure plugin management component and at least file input are visible
    await this.pluginManagement.waitFor({ state: 'visible', timeout: 5000 });
    await this.page
      .locator(PLUGIN_FILE_INPUT)
      .waitFor({ state: 'attached', timeout: 5000 });
  }

  /**
   * Navigate to plugin settings (settings page + expand plugin section)
   */
  async navigateToPluginSettings(): Promise<void> {
    const currentUrl = this.page.url();
    if (!currentUrl.includes('#/config')) {
      await this.navigateToSettings();
    }
    await this.expandPluginSection();
  }

  /**
   * Get a plugin card by plugin name or ID
   */
  async getPluginCard(pluginName: string): Promise<Locator | null> {
    const cards = await this.page.locator(PLUGIN_CARD).all();

    for (const card of cards) {
      const text = await card.textContent();
      if (text?.includes(pluginName)) {
        return card;
      }
    }
    return null;
  }

  /**
   * Check if a plugin exists
   */
  async pluginExists(pluginName: string): Promise<boolean> {
    const card = await this.getPluginCard(pluginName);
    return card !== null;
  }

  /**
   * Enable a plugin by name
   */
  async enablePlugin(pluginName: string): Promise<boolean> {
    const card = await this.getPluginCard(pluginName);
    if (!card) {
      return false;
    }

    const toggle = card.locator(PLUGIN_TOGGLE);
    const isEnabled = (await toggle.getAttribute('aria-checked')) === 'true';

    if (!isEnabled) {
      await toggle.click();
      await this.page.waitForTimeout(500);
      await waitForAngularStability(this.page);
    }

    return true;
  }

  /**
   * Disable a plugin by name
   */
  async disablePlugin(pluginName: string): Promise<boolean> {
    const card = await this.getPluginCard(pluginName);
    if (!card) {
      return false;
    }

    const toggle = card.locator(PLUGIN_TOGGLE);
    const isEnabled = (await toggle.getAttribute('aria-checked')) === 'true';

    if (isEnabled) {
      await toggle.click();
      await this.page.waitForTimeout(500);
      await waitForAngularStability(this.page);
    }

    return true;
  }

  /**
   * Check if a plugin is enabled
   */
  async isPluginEnabled(pluginName: string): Promise<boolean> {
    const card = await this.getPluginCard(pluginName);
    if (!card) {
      return false;
    }

    const toggle = card.locator(PLUGIN_TOGGLE);
    return (await toggle.getAttribute('aria-checked')) === 'true';
  }

  /**
   * Upload a plugin ZIP file
   */
  async uploadPlugin(pluginPath: string): Promise<void> {
    // Make file input visible
    await this.page.evaluate(() => {
      const input = document.querySelector(
        'input[type="file"][accept=".zip"]',
      ) as HTMLElement;
      if (input) {
        input.style.display = 'block';
        input.style.position = 'relative';
        input.style.opacity = '1';
      }
    });

    await this.page.locator(PLUGIN_FILE_INPUT).setInputFiles(pluginPath);
    await this.page.waitForTimeout(1000);
    await waitForAngularStability(this.page);
  }

  /**
   * Get all plugin names
   */
  async getAllPluginNames(): Promise<string[]> {
    const cards = await this.page.locator(PLUGIN_CARD).all();
    const names: string[] = [];

    for (const card of cards) {
      const titleEl = card.locator('mat-card-title');
      const title = await titleEl.textContent();
      if (title) {
        names.push(title.trim());
      }
    }

    return names;
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
    await this.page.goto('/#/tag/TODAY');
    await this.page.waitForLoadState('networkidle');
    await waitForAngularStability(this.page);
  }
}
