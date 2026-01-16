import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './base.page';

export class TagPage extends BasePage {
  readonly tagsGroup: Locator;
  readonly tagsList: Locator;
  readonly contextMenu: Locator;
  readonly tagMenu: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);
    this.tagsGroup = page.locator('nav-list-tree').filter({ hasText: 'Tags' });
    this.tagsList = this.tagsGroup.locator('.nav-children');
    this.contextMenu = page.locator('.mat-mdc-menu-content');
    this.tagMenu = page
      .locator('mat-menu')
      .filter({ has: page.locator('button:has-text("Add New Tag")') });
  }

  /**
   * Creates a new tag via the sidebar
   */
  async createTag(tagName: string): Promise<void> {
    // Find the Tags group header button
    const tagsGroupBtn = this.tagsGroup
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await tagsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Ensure Tags group is expanded
    const isExpanded = await tagsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await tagsGroupBtn.click();
      await this.page.waitForTimeout(500);
    }

    // Hover to show additional buttons
    await tagsGroupBtn.hover();
    await this.page.waitForTimeout(300);

    // Click the add tag button
    const addTagBtn = this.tagsGroup.locator(
      '.additional-btns button[mat-icon-button]:has(mat-icon:text("add"))',
    );
    try {
      await addTagBtn.waitFor({ state: 'visible', timeout: 3000 });
      await addTagBtn.click();
    } catch {
      // Force click if not visible
      await addTagBtn.click({ force: true });
    }

    // Wait for create tag dialog (uses "Tag Name" label in sidebar create dialog)
    const tagNameInput = this.page.getByRole('textbox', { name: 'Tag Name' });
    await tagNameInput.waitFor({ state: 'visible', timeout: 5000 });
    await tagNameInput.fill(tagName);

    // Submit the form - click the Save button
    const submitBtn = this.page.getByRole('button', { name: 'Save' });
    await submitBtn.click();

    // Wait for dialog to close
    await tagNameInput.waitFor({ state: 'hidden', timeout: 3000 });
  }

  /**
   * Assigns a tag to a task via context menu
   */
  async assignTagToTask(task: Locator, tagName: string): Promise<void> {
    // Exit any edit mode by pressing Escape first
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);

    // Right-click to open context menu
    await task.click({ button: 'right' });

    // Click "Toggle Tags" menu item
    const toggleTagsBtn = this.page.locator('.mat-mdc-menu-content button', {
      hasText: 'Toggle Tags',
    });
    await toggleTagsBtn.waitFor({ state: 'visible', timeout: 5000 });
    await toggleTagsBtn.click();

    // Wait for tag submenu to appear
    await this.page.waitForTimeout(300);

    // Find and click the tag in the submenu
    const tagOption = this.page.locator('.mat-mdc-menu-content button', {
      hasText: tagName,
    });

    // Check if tag exists, if not create it via "Add New Tag"
    const tagExists = await tagOption.isVisible({ timeout: 2000 }).catch(() => false);
    if (tagExists) {
      await tagOption.click();
    } else {
      // Click "Add New Tag" option
      const addNewTagBtn = this.page.locator('.mat-mdc-menu-content button', {
        hasText: 'Add New Tag',
      });
      await addNewTagBtn.click();

      // Fill in tag name in dialog
      const tagNameInput = this.page.getByRole('textbox', { name: 'Add new Tag' });
      await tagNameInput.waitFor({ state: 'visible', timeout: 5000 });
      await tagNameInput.fill(tagName);

      // Submit - click the Save button
      const submitBtn = this.page.getByRole('button', { name: 'Save' });
      await submitBtn.click();

      // Wait for dialog to close
      await tagNameInput.waitFor({ state: 'hidden', timeout: 3000 });
    }

    // Wait for menu to close and overlay to disappear
    // The stopPropagation wrapper can prevent proper menu closing, so explicitly wait for overlay removal
    await this.page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    await this.page.waitForTimeout(300);
  }

  /**
   * Removes a tag from a task via context menu
   */
  async removeTagFromTask(task: Locator, tagName: string): Promise<void> {
    // Exit any edit mode by pressing Escape first
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);

    // Right-click to open context menu
    await task.click({ button: 'right' });

    // Click "Toggle Tags" menu item
    const toggleTagsBtn = this.page.locator('.mat-mdc-menu-content button', {
      hasText: 'Toggle Tags',
    });
    await toggleTagsBtn.waitFor({ state: 'visible', timeout: 5000 });
    await toggleTagsBtn.click();

    // Wait for tag submenu
    await this.page.waitForTimeout(300);

    // Click the tag (which will uncheck it since it's assigned)
    const tagOption = this.page.locator('.mat-mdc-menu-content button', {
      hasText: tagName,
    });
    await tagOption.waitFor({ state: 'visible', timeout: 3000 });
    await tagOption.click();

    // Wait for menu to close and overlay to disappear
    // The stopPropagation wrapper can prevent proper menu closing, so explicitly wait for overlay removal
    await this.page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});
    await this.page.waitForTimeout(300);
  }

  /**
   * Checks if a tag exists in the sidebar
   */
  async tagExistsInSidebar(tagName: string): Promise<boolean> {
    // Retry logic for flaky detection
    for (let attempt = 0; attempt < 3; attempt++) {
      // Ensure Tags section is expanded
      const tagsMenuitem = this.page.getByRole('menuitem', { name: 'Tags', exact: true });
      try {
        await tagsMenuitem.waitFor({ state: 'visible', timeout: 3000 });
        const isExpanded = await tagsMenuitem.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await tagsMenuitem.click();
          await this.page.waitForTimeout(500);
        }
      } catch {
        // Continue anyway
      }

      // Wait for tags to load
      await this.page.waitForTimeout(500);

      // Try multiple selectors
      const selectors = [
        this.page.getByText(tagName, { exact: true }),
        this.page.locator(`[role="treeitem"]`).filter({ hasText: tagName }),
        this.page.locator(`[role="menuitem"]`).filter({ hasText: tagName }),
      ];

      for (const selector of selectors) {
        const visible = await selector
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (visible) return true;
      }

      // Wait before retry
      if (attempt < 2) {
        await this.page.waitForTimeout(1000);
      }
    }
    return false;
  }

  /**
   * Gets the tag locator on a task
   */
  getTagOnTask(task: Locator, tagName: string): Locator {
    // Tags are displayed using <tag> component with .tag-title span
    return task.locator('tag').filter({ hasText: tagName });
  }

  /**
   * Checks if task has a specific tag
   */
  async taskHasTag(task: Locator, tagName: string): Promise<boolean> {
    const tag = this.getTagOnTask(task, tagName);
    return tag.isVisible({ timeout: 2000 }).catch(() => false);
  }

  /**
   * Deletes a tag via the sidebar context menu
   */
  async deleteTag(tagName: string): Promise<void> {
    // Ensure any open menus/overlays are closed before starting
    await this.page
      .locator('.cdk-overlay-backdrop')
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {});

    // Ensure Tags section is expanded
    const tagsGroupBtn = this.tagsGroup
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await tagsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });

    const isExpanded = await tagsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await tagsGroupBtn.click();
      await this.page.waitForTimeout(500);
    }

    // Find the tag in the sidebar
    const tagTreeItem = this.tagsGroup
      .locator('[role="treeitem"]')
      .filter({ hasText: tagName })
      .first();
    await tagTreeItem.waitFor({ state: 'visible', timeout: 5000 });

    // Right-click to open context menu
    await tagTreeItem.click({ button: 'right' });

    // Click delete option - look for "Delete Tag" text
    const deleteBtn = this.page
      .locator('.mat-mdc-menu-content button')
      .filter({ hasText: /delete/i })
      .first();
    await deleteBtn.waitFor({ state: 'visible', timeout: 3000 });
    await deleteBtn.click();

    // Handle confirmation dialog
    const confirmDialog = this.page.locator('dialog-confirm');
    await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
    // Click "Ok" button to confirm deletion
    const confirmBtn = confirmDialog.locator('button').filter({ hasText: /ok/i });
    await confirmBtn.click();
    await confirmDialog.waitFor({ state: 'hidden', timeout: 3000 });

    // Wait for tag to be removed from sidebar
    await tagTreeItem.waitFor({ state: 'hidden', timeout: 5000 });
  }
}
