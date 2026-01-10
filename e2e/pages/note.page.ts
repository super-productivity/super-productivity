import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';

export class NotePage extends BasePage {
  readonly toggleNotesBtn: Locator;
  readonly addNoteBtn: Locator;
  readonly notesSection: Locator;
  readonly notesList: Locator;
  readonly noteDialog: Locator;
  readonly noteTextarea: Locator;
  readonly saveNoteBtn: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);
    this.toggleNotesBtn = page.locator('.e2e-toggle-notes-btn');
    // Use multiple selectors for addNoteBtn - the button text or ID
    this.addNoteBtn = page.locator(
      '#add-note-btn, button:has-text("Add new Note"), [role="button"]:has-text("Add new Note")',
    );
    // notes section can be the Angular component or the panel containing the add note button
    this.notesSection = page.locator(
      'notes, .notes-panel, [class*="notes"]:has(button:has-text("Add new Note"))',
    );
    this.notesList = page.locator('notes .notes, .notes-list');
    // Use dialog-fullscreen-markdown specifically as it's the note edit component
    this.noteDialog = page.locator('dialog-fullscreen-markdown');
    this.noteTextarea = page.locator('dialog-fullscreen-markdown textarea');
    this.saveNoteBtn = page.locator(
      '#T-save-note, button:has(mat-icon:has-text("save"))',
    );
  }

  /**
   * Ensures notes section is visible
   */
  async ensureNotesVisible(): Promise<void> {
    // Wait for the page to be ready
    await this.page.waitForLoadState('networkidle');

    // Check if "Add new Note" button is visible as indicator that notes panel is open
    const addNoteBtnVisible = await this.addNoteBtn
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (addNoteBtnVisible) {
      // Notes panel is already visible
      return;
    }

    // Also check if notesSection is visible
    const isNotesVisible = await this.notesSection
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (isNotesVisible) {
      return;
    }

    // Toggle notes panel via header button
    const isToggleBtnVisible = await this.toggleNotesBtn
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (isToggleBtnVisible) {
      await this.toggleNotesBtn.click();
      // Wait for either the section or the add note button to become visible
      await this.page
        .locator('notes, button:has-text("Add new Note")')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 });
    }
    // If toggle button not visible, notes might already be visible or on a page without notes
  }

  /**
   * Adds a new note with the given content
   */
  async addNote(content: string): Promise<void> {
    await this.ensureNotesVisible();

    // Wait for add note button to be visible
    await this.addNoteBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Move mouse away first to dismiss any tooltip, then click
    await this.page.mouse.move(0, 0);
    await this.page.waitForTimeout(300);
    await this.addNoteBtn.click();

    // Wait for dialog
    await this.noteDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill content
    const textarea = this.page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill(content);

    // Save
    let saveBtn = this.page.locator('#T-save-note');
    let saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!saveBtnVisible) {
      saveBtn = this.page.locator('button:has(mat-icon:has-text("save"))');
      saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);
    }

    if (saveBtnVisible) {
      await saveBtn.click();
    } else {
      // Fallback: use keyboard shortcut
      await textarea.press('Control+Enter');
    }

    // Wait for dialog to close
    await this.noteDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Gets a note by its content
   * Uses specific selector for the note component
   */
  getNoteByContent(content: string): Locator {
    // Use the Angular note component tag with the specific content
    // The structure is: <note><div class="note">content</div></note>
    return this.page.locator(`note:has-text("${content}")`);
  }

  /**
   * Edits a note's content
   */
  async editNote(note: Locator, newContent: string): Promise<void> {
    // Click on note to open edit dialog
    await note.click();

    // Wait for dialog
    await this.noteDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Clear and fill new content
    const textarea = this.page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.clear();
    await textarea.fill(newContent);

    // Save
    let saveBtn = this.page.locator('#T-save-note');
    const saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!saveBtnVisible) {
      saveBtn = this.page.locator('button:has(mat-icon:has-text("save"))');
    }

    await saveBtn.click();

    // Wait for dialog to close
    await this.noteDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Deletes a note via menu button
   */
  async deleteNote(note: Locator): Promise<void> {
    // Find the menu button (more_vert) on the note
    const menuBtn = note.locator('button:has(mat-icon:has-text("more_vert"))');
    const menuBtnVisible = await menuBtn.isVisible({ timeout: 1000 }).catch(() => false);

    if (menuBtnVisible) {
      // Click menu button to open menu
      await menuBtn.click();
    } else {
      // Fallback: right-click on note
      await note.click({ button: 'right' });
    }

    // Click delete in menu
    const deleteBtn = this.page.locator(
      '.mat-mdc-menu-content button.color-warn, .mat-mdc-menu-content button:has(mat-icon:has-text("delete"))',
    );
    await deleteBtn.waitFor({ state: 'visible', timeout: 3000 });
    await deleteBtn.click();

    // Handle confirmation dialog if it appears
    const confirmDialog = this.page.locator('dialog-confirm');
    const confirmVisible = await confirmDialog
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (confirmVisible) {
      await confirmDialog.locator('button[color="warn"]').click();
    }

    // Wait for note to be removed
    await this.page.waitForTimeout(500);
  }

  /**
   * Checks if a note with the given content exists
   * Uses Playwright's waitFor for reliable detection
   */
  async noteExists(content: string, timeout = 15000): Promise<boolean> {
    await this.ensureNotesVisible();

    // Wait a bit for the UI to settle
    await this.page.waitForTimeout(1000);

    // Fast path: if "no notes" is visible, return false
    const noNotesVisible = await this.page
      .getByText('There are currently no notes')
      .isVisible()
      .catch(() => false);
    if (noNotesVisible) {
      return false;
    }

    try {
      // Try to find the content - if found within timeout, return true
      await this.page.getByText(content).first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      // Content not found within timeout - return false
      return false;
    }
  }

  /**
   * Gets the count of notes
   */
  async getNoteCount(): Promise<number> {
    await this.ensureNotesVisible();
    return this.notesSection.locator('note').count();
  }
}
