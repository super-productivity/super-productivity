import { Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';
import { cssSelectors } from '../constants/selectors';
import { waitForAngularStability } from '../utils/waits';

const { MAT_DIALOG, DIALOG_FULLSCREEN_MARKDOWN, SAVE_NOTE_BTN } = cssSelectors;

export class DialogPage extends BasePage {
  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);
  }

  /**
   * Wait for any dialog to appear
   */
  async waitForDialog(timeout: number = 10000): Promise<Locator> {
    const dialog = this.page.locator(MAT_DIALOG).first();
    await dialog.waitFor({ state: 'visible', timeout });
    return dialog;
  }

  /**
   * Wait for dialog to close
   */
  async waitForDialogToClose(timeout: number = 10000): Promise<void> {
    await this.page.locator(MAT_DIALOG).waitFor({ state: 'hidden', timeout });
    await waitForAngularStability(this.page);
  }

  /**
   * Check if any dialog is open
   */
  async isDialogOpen(): Promise<boolean> {
    return await this.page.locator(MAT_DIALOG).isVisible();
  }

  /**
   * Get dialog by aria-label
   */
  getDialogByLabel(label: string): Locator {
    return this.page.locator(`[role="dialog"][aria-label="${label}"]`);
  }

  /**
   * Click dialog button by text
   */
  async clickDialogButton(buttonText: string): Promise<void> {
    const dialog = this.page.locator(MAT_DIALOG);
    const button = dialog.getByRole('button', { name: buttonText });
    await button.waitFor({ state: 'visible', timeout: 5000 });
    await button.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Click Save button in dialog
   */
  async clickSaveButton(): Promise<void> {
    await this.clickDialogButton('Save');
  }

  /**
   * Click Cancel button in dialog
   */
  async clickCancelButton(): Promise<void> {
    await this.clickDialogButton('Cancel');
  }

  /**
   * Fill input field in dialog
   */
  async fillDialogInput(
    inputSelector: string,
    value: string,
    clearFirst: boolean = true,
  ): Promise<void> {
    const dialog = this.page.locator(MAT_DIALOG);
    const input = dialog.locator(inputSelector);
    await input.waitFor({ state: 'visible', timeout: 5000 });

    if (clearFirst) {
      await input.clear();
      await this.page.waitForTimeout(50);
    }

    await input.fill(value);
    await this.page.waitForTimeout(100);
  }

  /**
   * Get dialog title
   */
  async getDialogTitle(): Promise<string> {
    const dialog = this.page.locator(MAT_DIALOG);
    const title = dialog.locator('h2, mat-dialog-title, .mat-dialog-title').first();
    return (await title.textContent()) || '';
  }

  /**
   * Wait for fullscreen markdown dialog (for notes)
   */
  async waitForMarkdownDialog(timeout: number = 10000): Promise<Locator> {
    const dialog = this.page.locator(DIALOG_FULLSCREEN_MARKDOWN);
    await dialog.waitFor({ state: 'visible', timeout });
    return dialog;
  }

  /**
   * Fill markdown textarea in fullscreen dialog
   */
  async fillMarkdownDialog(content: string): Promise<void> {
    const dialog = this.page.locator(DIALOG_FULLSCREEN_MARKDOWN);
    const textarea = dialog.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 5000 });
    await textarea.fill(content);
  }

  /**
   * Save markdown dialog
   */
  async saveMarkdownDialog(): Promise<void> {
    const saveBtn = this.page.locator(SAVE_NOTE_BTN);
    const saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (saveBtnVisible) {
      await saveBtn.click();
    } else {
      // Fallback: try button with save icon
      const saveBtnFallback = this.page.locator('button:has(mat-icon:has-text("save"))');
      const fallbackVisible = await saveBtnFallback
        .isVisible({ timeout: 2000 })
        .catch(() => false);

      if (fallbackVisible) {
        await saveBtnFallback.click();
      } else {
        // Last resort: keyboard shortcut
        await this.page.keyboard.press('Control+Enter');
      }
    }

    await this.waitForDialogToClose();
  }

  /**
   * Close markdown dialog without saving
   */
  async closeMarkdownDialog(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.waitForDialogToClose();
  }

  /**
   * Edit date/time in task detail
   */
  async editDateTime(dateValue?: string, timeValue?: string): Promise<void> {
    if (dateValue !== undefined) {
      const dateInput = this.page.getByRole('textbox', { name: 'Date' });
      await dateInput.waitFor({ state: 'visible', timeout: 3000 });
      await dateInput.fill(dateValue);
    }

    if (timeValue !== undefined) {
      const timeInput = this.page.getByRole('combobox', { name: 'Time' });
      await timeInput.waitFor({ state: 'visible', timeout: 3000 });
      await timeInput.fill(timeValue);
    }

    await this.page.waitForTimeout(200);
  }

  /**
   * Open calendar picker
   */
  async openCalendarPicker(): Promise<void> {
    const openCalendarBtn = this.page.getByRole('button', { name: 'Open calendar' });
    await openCalendarBtn.waitFor({ state: 'visible', timeout: 3000 });
    await openCalendarBtn.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Select first day of next month in calendar
   */
  async selectFirstDayOfNextMonth(): Promise<void> {
    await this.openCalendarPicker();
    await this.page.getByRole('button', { name: 'Next month' }).click();
    await this.page.locator('mat-month-view button').first().click();
  }

  /**
   * Check if Save button is enabled
   */
  async isSaveButtonEnabled(): Promise<boolean> {
    const saveBtn = this.page.getByRole('button', { name: 'Save' });
    return !(await saveBtn.isDisabled());
  }

  /**
   * Close dialog by clicking backdrop
   */
  async closeDialogByBackdrop(): Promise<void> {
    await this.backdrop.click();
    await this.waitForDialogToClose();
  }

  /**
   * Close dialog by pressing Escape
   */
  async closeDialogByEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.waitForDialogToClose();
  }
}
