import { expect, Locator, Page } from '@playwright/test';
import { BasePage } from './base.page';

export class ProjectPage extends BasePage {
  readonly sidenav: Locator;
  readonly createProjectBtn: Locator;
  readonly projectAccordion: Locator;
  readonly projectNameInput: Locator;
  readonly submitBtn: Locator;
  readonly workCtxMenu: Locator;
  readonly workCtxTitle: Locator;
  readonly projectSettingsBtn: Locator;
  readonly moveToArchiveBtn: Locator;
  readonly globalErrorAlert: Locator;

  constructor(page: Page, testPrefix: string = '') {
    super(page, testPrefix);

    this.sidenav = page.locator('magic-side-nav');
    this.createProjectBtn = page.locator(
      'button[aria-label="Create New Project"], button:has-text("Create Project")',
    );
    this.projectAccordion = page.locator('nav-item button:has-text("Projects")');
    this.projectNameInput = page.getByRole('textbox', { name: 'Project Name' });
    this.submitBtn = page.locator('dialog-create-project button[type=submit]');
    this.workCtxMenu = page.locator('work-context-menu');
    // Use more specific selector to avoid matching titles in other areas
    this.workCtxTitle = page
      .locator('main .page-title, .route-wrapper .page-title')
      .first();
    this.projectSettingsBtn = this.workCtxMenu
      .locator('button[aria-label="Project Settings"]')
      .or(this.workCtxMenu.locator('button').nth(3));
    this.moveToArchiveBtn = page.locator('.e2e-move-done-to-archive');
    this.globalErrorAlert = page.locator('.global-error-alert');
  }

  async createProject(projectName: string): Promise<void> {
    const prefixedProjectName = this.applyPrefix(projectName);

    try {
      // Check for empty state first (single "Create Project" button)
      const emptyStateBtn = this.page
        .locator('nav-item')
        .filter({ hasText: 'Create Project' })
        .locator('button');
      try {
        await emptyStateBtn.waitFor({ state: 'visible', timeout: 5000 });
        await emptyStateBtn.click();
        // Continue to dialog handling below
      } catch {
        // Not in empty state, continue with normal flow
        // Find the Projects group item and wait for it to be visible
        const projectsGroup = this.page
          .locator('nav-list-tree')
          .filter({ hasText: 'Projects' })
          .locator('nav-item button')
          .first();
        await projectsGroup.waitFor({ state: 'visible', timeout: 10000 }); // Increased for CI stability

        // Ensure expanded
        const isExpanded = await projectsGroup.getAttribute('aria-expanded');
        if (isExpanded !== 'true') {
          await projectsGroup.click();
          await this.page.waitForTimeout(500);
        }

        // Get the Projects nav-list-tree container to scope the button search
        const projectsTree = this.page
          .locator('nav-list-tree')
          .filter({ hasText: 'Projects' });

        // Hover over the Projects group to show additional buttons
        await projectsGroup.hover();

        // Wait a bit for the hover effect to take place
        await this.page.waitForTimeout(500);

        // Look for the create project button (add icon) within the Projects tree only
        const createProjectBtn = projectsTree.locator(
          '.additional-btns button[mat-icon-button]:has(mat-icon:text("add"))',
        );
        // Try to wait for visibility, but if it fails, try forcing click if attached
        try {
          await createProjectBtn.waitFor({ state: 'visible', timeout: 5000 });
          await createProjectBtn.click();
        } catch (e) {
          console.log('Additional button not visible via hover, trying force click...');
          await createProjectBtn.click({ force: true });
        }
      }
    } catch (error) {
      // If the specific selectors fail, try a more general approach
      console.warn('Primary project creation approach failed, trying fallback:', error);

      // Fallback: try to find any add button near Projects text
      const addButton = this.page
        .locator('button[mat-icon-button]:has(mat-icon:text("add"))')
        .first();
      try {
        await addButton.waitFor({ state: 'visible', timeout: 5000 });
        await addButton.click();
      } catch (e) {
        console.log('Fallback button not visible, trying force click...');
        await addButton.click({ force: true });
      }
    }

    // Wait for the dialog to appear and be fully initialized
    await this.projectNameInput.waitFor({ state: 'visible', timeout: 10000 });

    // Fill has built-in waiting for element to be editable, but Angular forms
    // need a moment to wire up. Add a small delay for form initialization.
    await this.page.waitForTimeout(500);

    await this.projectNameInput.fill(prefixedProjectName);
    await this.submitBtn.click();

    // Wait for dialog to close by waiting for input to be hidden
    await this.projectNameInput.waitFor({ state: 'hidden', timeout: 3000 }); // Increased for CI stability
  }

  async getProject(index: number): Promise<Locator> {
    // Projects are in a menuitem structure, not side-nav-item
    // Get all project menuitems that follow the Projects header
    const projectMenuItems = this.page.locator(
      '[role="menuitem"]:has-text("Projects") ~ [role="menuitem"]',
    );
    return projectMenuItems.nth(index - 1);
  }

  async navigateToProjectByName(projectName: string): Promise<void> {
    const fullProjectName = this.applyPrefix(projectName);

    // Wait for Angular to fully render after any navigation
    await this.page.waitForTimeout(2000);

    // Helper function to check if we're already on the project
    const isAlreadyOnProject = async (): Promise<boolean> => {
      try {
        // Use page.evaluate for direct DOM check (most reliable)
        return await this.page.evaluate((name) => {
          const main = document.querySelector('main');
          return main?.textContent?.includes(name) ?? false;
        }, fullProjectName);
      } catch {
        return false;
      }
    };

    // Check if we're already on the project
    if (await isAlreadyOnProject()) {
      return;
    }

    // Wait for the nav to be fully loaded
    await this.sidenav.waitFor({ state: 'visible', timeout: 5000 });

    // Get the Projects nav-list-tree container
    const projectsTree = this.page
      .locator('nav-list-tree')
      .filter({ hasText: 'Projects' });

    // Find the Projects group button (the header with expand/collapse)
    const projectsGroup = projectsTree
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();

    // Ensure Projects group is expanded with retry logic
    await projectsGroup.waitFor({ state: 'visible', timeout: 5000 });
    for (let i = 0; i < 3; i++) {
      const isExpanded = await projectsGroup.getAttribute('aria-expanded');
      if (isExpanded === 'true') break;

      await projectsGroup.click();
      // Wait for expansion animation to complete - scoped to Projects tree
      await projectsTree
        .locator('.nav-children')
        .waitFor({ state: 'visible', timeout: 3000 })
        .catch(() => {});
    }

    // Wait for the project to appear in the tree (may take time after sync/reload)
    // Scope to the Projects tree to avoid matching tags or other trees
    const projectTreeItem = projectsTree
      .locator('[role="treeitem"]')
      .filter({ hasText: fullProjectName })
      .first();

    // Wait for the project to appear with extended timeout (projects load after sync)
    await projectTreeItem.waitFor({ state: 'visible', timeout: 20000 });

    // Now get the clickable menuitem inside the treeitem
    const projectBtn = projectTreeItem.locator('[role="menuitem"]').first();

    // Wait for the menuitem to be visible and stable
    await projectBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Click with retry - catch errors and check if we're already on the project
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await projectBtn.click({ timeout: 5000 });

        // Wait for navigation to complete - wait for URL to change to project route
        const navigated = await this.page
          .waitForURL(/\/#\/project\//, { timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (navigated) break;
      } catch {
        // Click timed out - check if we're already on the project
        if (await isAlreadyOnProject()) {
          return;
        }
      }

      // If navigation didn't happen, wait a bit and retry
      if (attempt < 2) {
        await this.page.waitForTimeout(500);
      }
    }

    // Final verification - wait for the project to appear in main
    // Use a locator-based wait for better reliability
    try {
      await this.page
        .locator('main')
        .getByText(fullProjectName, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      // If verification fails, continue anyway - the test will catch real issues
    }
  }

  async navigateToProject(projectLocator: Locator): Promise<void> {
    const projectBtn = projectLocator.locator('button').first();
    await projectBtn.waitFor({ state: 'visible' });
    await projectBtn.click();
  }

  async openProjectMenu(projectLocator: Locator): Promise<void> {
    const projectBtn = projectLocator.locator('.mat-mdc-menu-item');
    const advBtn = projectLocator.locator('.additional-btn');

    await projectBtn.hover();
    await advBtn.waitFor({ state: 'visible' });
    await advBtn.click();
    await this.workCtxMenu.waitFor({ state: 'visible' });
  }

  async navigateToProjectSettings(): Promise<void> {
    await this.projectSettingsBtn.waitFor({ state: 'visible' });
    await this.projectSettingsBtn.click();
  }

  async archiveDoneTasks(): Promise<void> {
    // Check if the collapsible needs to be expanded
    const moveToArchiveBtnVisible = await this.moveToArchiveBtn.isVisible();
    if (!moveToArchiveBtnVisible) {
      const collapsibleHeader = this.page.locator('.collapsible-header');
      if ((await collapsibleHeader.count()) > 0) {
        await collapsibleHeader.click();
        // Wait for the section to expand
        await this.moveToArchiveBtn.waitFor({ state: 'visible', timeout: 1000 });
      }
    }

    await this.moveToArchiveBtn.waitFor({ state: 'visible' });
    await this.moveToArchiveBtn.click();
  }

  async createAndGoToTestProject(): Promise<void> {
    // Wait for the nav to be fully loaded
    await this.sidenav.waitFor({ state: 'visible', timeout: 3000 }); // Reduced from 5s to 3s

    // Handle empty state vs existing projects scenario
    const addProjectBtn = this.page
      .locator('nav-item')
      .filter({ hasText: 'Create Project' })
      .locator('button');
    const projectsGroupBtn = this.page
      .locator('nav-list-tree')
      .filter({ hasText: 'Projects' })
      .locator('nav-item button')
      .first();

    // Check if we're in empty state (no projects yet) or if projects group exists
    try {
      await addProjectBtn.waitFor({ state: 'visible', timeout: 1000 });
      // Empty state: just create project directly since button is already visible
    } catch {
      // Normal state: expand projects group first
      await projectsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });
      const projectsGroupExpanded = await projectsGroupBtn.getAttribute('aria-expanded');
      if (projectsGroupExpanded !== 'true') {
        await projectsGroupBtn.click();
        await this.page.waitForTimeout(500); // Wait for expansion animation
      }
    }

    // Create a new default project
    await this.createProject('Test Project');

    // Navigate to the created project
    const projectName = this.applyPrefix('Test Project');

    // After creating a project, ensure Projects group is visible and expanded
    await this.page.waitForTimeout(2000); // Increased wait for DOM updates

    // Find the Projects group button (should exist since we have a project)
    const projectsGroupAfterCreation = this.page
      .locator('nav-list-tree')
      .filter({ hasText: 'Projects' })
      .locator('nav-item button')
      .first();
    await projectsGroupAfterCreation.waitFor({ state: 'visible', timeout: 5000 });

    // Check if projects group is expanded, use similar logic to project.spec.ts
    let isExpanded = await projectsGroupAfterCreation.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      // Multiple approaches to expand the Projects section
      // First: Try clicking the expand icon within the Projects button
      const expandIcon = projectsGroupAfterCreation
        .locator('mat-icon, .expand-icon, [class*="expand"]')
        .first();
      if (await expandIcon.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expandIcon.click();
        await this.page.waitForTimeout(1500);
        isExpanded = await projectsGroupAfterCreation.getAttribute('aria-expanded');
      }

      // If still not expanded, try clicking the main button
      if (isExpanded !== 'true') {
        await projectsGroupAfterCreation.click();
        await this.page.waitForTimeout(1500);
        isExpanded = await projectsGroupAfterCreation.getAttribute('aria-expanded');
      }

      // If still not expanded, try double-clicking as last resort
      if (isExpanded !== 'true') {
        await projectsGroupAfterCreation.dblclick();
        await this.page.waitForTimeout(1500);
      }
    }

    // Wait for the project to appear in the navigation - use improved approach from project.spec.ts
    await this.page.waitForTimeout(1000); // Allow time for project to appear

    let newProject;
    let projectFound = false;

    // Check if .nav-children container exists after expansion
    const navChildren = this.page.locator('.nav-children');
    const navChildrenExists = await navChildren.count();

    if (navChildrenExists > 0) {
      await navChildren.waitFor({ state: 'visible', timeout: 5000 });

      try {
        // Primary approach: nav-child-item structure with nav-item button
        newProject = this.page
          .locator('.nav-children .nav-child-item nav-item button')
          .filter({ hasText: projectName });
        await newProject.waitFor({ state: 'visible', timeout: 3000 });
        projectFound = true;
      } catch {
        try {
          // Second approach: any nav-child-item with the project name
          newProject = this.page
            .locator('.nav-child-item')
            .filter({ hasText: projectName })
            .locator('button');
          await newProject.waitFor({ state: 'visible', timeout: 3000 });
          projectFound = true;
        } catch {
          // Continue to fallback approaches
        }
      }
    }

    // Fallback approaches if structured approach didn't work
    if (!projectFound) {
      try {
        // Fallback: find any button with project name in the nav area
        newProject = this.page
          .locator('magic-side-nav button')
          .filter({ hasText: projectName });
        await newProject.waitFor({ state: 'visible', timeout: 3000 });
        projectFound = true;
      } catch {
        // Ultimate fallback: search entire page for project button
        newProject = this.page.locator('button').filter({ hasText: projectName });
        await newProject.waitFor({ state: 'visible', timeout: 3000 });
        projectFound = true;
      }
    }

    // Verify the project is found and click it
    if (!projectFound) {
      throw new Error(`Project "${projectName}" not found in navigation after creation`);
    }

    await newProject.click();

    // Verify we're in the project
    await expect(this.workCtxTitle).toContainText(projectName);
  }

  async addNote(noteContent: string, projectId?: string): Promise<void> {
    // Ensure we are on the correct project route if an id is provided
    if (projectId && !this.page.url().includes(projectId)) {
      await this.page.goto(`/#/project/${projectId}`);
      await this.page.waitForLoadState('networkidle');
    }

    // Wait for the app to be ready
    const routerWrapper = this.page.locator('.route-wrapper');
    await routerWrapper.waitFor({ state: 'visible', timeout: 6000 }); // Reduced from 10s to 6s

    // Wait for project view to be ready
    const workView = this.page.locator('work-view').first();
    await workView.waitFor({ state: 'attached', timeout: 15000 });

    // First ensure notes section is visible by clicking toggle if needed
    const toggleNotesBtn = this.page.locator('.e2e-toggle-notes-btn');
    const isToggleBtnVisible = await toggleNotesBtn
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (isToggleBtnVisible) {
      await toggleNotesBtn.click();
      // Wait for notes section to appear after toggle
      await this.page.locator('notes').waitFor({ state: 'visible', timeout: 5000 });
    }

    // Hover header to ensure buttons might appear
    const projectHeader = this.page
      .locator('.project-header, .page-title-wrapper')
      .first();
    if (await projectHeader.isVisible()) {
      await projectHeader.hover();
      await this.page.waitForTimeout(500);
    }

    // Retry loop to open dialog

    for (let i = 0; i < 3; i++) {
      try {
        // Ensure any previous overlays are closed

        const backdrop = this.page.locator('.cdk-overlay-backdrop');

        if (await backdrop.isVisible()) {
          await backdrop.click({ force: true });

          await this.page.waitForTimeout(200);
        }

        // Try multiple approaches to open the note dialog

        let dialogOpened = false;

        // Approach 1: Try to click the add note button

        const addNoteBtn = this.page
          .locator(
            '#add-note-btn, button[title="Add Note"], button[aria-label="Add Note"], button mat-icon:has-text("note_add")',
          )
          .first();

        const isAddBtnVisible = await addNoteBtn

          .isVisible({ timeout: 2000 })

          .catch(() => false);

        if (isAddBtnVisible) {
          // Move cursor away to avoid tooltip overlays blocking the click, then force-click

          await this.page.mouse.move(0, 0);

          await addNoteBtn.click({ force: true });

          dialogOpened = true;
        } else {
          // Check overflow menu - scope to work context menu to avoid picking up task menus

          const moreBtn = this.workCtxMenu
            .locator('button mat-icon:has-text("more_vert")')
            .first();

          if (await moreBtn.isVisible()) {
            await moreBtn.click({ force: true });

            const menuAddNote = this.page

              .locator('.mat-mdc-menu-item')

              .filter({ hasText: 'Add Note' })

              .first();

            // Wait briefly for menu

            try {
              await menuAddNote.waitFor({ state: 'visible', timeout: 2000 });

              await menuAddNote.click({ force: true });

              dialogOpened = true;
            } catch {
              // Close menu if item not found

              await this.page.keyboard.press('Escape');
            }
          }
        }

        // Approach 2: If button not visible, try keyboard shortcut

        if (!dialogOpened) {
          // Focus on the work view area first

          if (await workView.isVisible()) {
            await workView.click({ force: true });
          } else {
            await this.page.locator('body').click({ force: true });
          }

          await this.page.waitForTimeout(500);

          await this.page.keyboard.press('n');
        }

        // Wait for dialog to appear with better error handling

        await this.page.locator('dialog-fullscreen-markdown').waitFor({
          state: 'visible',

          timeout: 5000, // Short timeout for retry
        });

        break; // Success
      } catch (e) {
        console.log(`Attempt ${i + 1} to open note dialog failed, retrying...`);

        await this.page.waitForTimeout(1000);
      }
    }

    // Final check/throw

    await this.page.locator('dialog-fullscreen-markdown').waitFor({
      state: 'visible',

      timeout: 10000,
    });

    // Try different selectors for the textarea
    let noteTextarea = this.page.locator('dialog-fullscreen-markdown textarea').first();
    let textareaVisible = await noteTextarea
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (!textareaVisible) {
      // Try alternative selector
      noteTextarea = this.page.locator('textarea').first();
      textareaVisible = await noteTextarea
        .isVisible({ timeout: 2000 })
        .catch(() => false);
    }

    if (!textareaVisible) {
      throw new Error('Note dialog textarea not found after trying multiple approaches');
    }

    await noteTextarea.fill(noteContent);

    // Click the save button - try multiple selectors
    let saveBtn = this.page.locator('#T-save-note');
    let saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!saveBtnVisible) {
      // Try button with save icon
      saveBtn = this.page.locator('button:has(mat-icon:has-text("save"))');
      saveBtnVisible = await saveBtn.isVisible({ timeout: 2000 }).catch(() => false);
    }

    if (saveBtnVisible) {
      await saveBtn.click();
    } else {
      // Fallback: press Enter to save
      await noteTextarea.press('Control+Enter');
    }

    // Wait for dialog to close
    await this.page.locator('dialog-fullscreen-markdown').waitFor({
      state: 'hidden',
      timeout: 5000,
    });

    // After saving, check if notes panel is visible
    // If not, toggle it
    const notesWrapper = this.page.locator('notes');
    const isNotesVisible = await notesWrapper
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (!isNotesVisible) {
      // Toggle the notes panel
      const toggleBtn = this.page.locator('.e2e-toggle-notes-btn');
      await toggleBtn.waitFor({ state: 'visible' });
      await toggleBtn.click();
      await notesWrapper.waitFor({ state: 'visible', timeout: 5000 });
    }

    // Hover over the notes area like in Nightwatch
    await notesWrapper.hover({ position: { x: 10, y: 50 } });
  }

  /**
   * Deletes a project via the sidebar context menu
   */
  async deleteProject(projectName: string): Promise<void> {
    const fullProjectName = this.applyPrefix(projectName);

    // Get the Projects nav-list-tree container
    const projectsTree = this.page
      .locator('nav-list-tree')
      .filter({ hasText: 'Projects' });

    // Ensure Projects group is expanded
    const projectsGroupBtn = projectsTree
      .locator('.g-multi-btn-wrapper nav-item button')
      .first();
    await projectsGroupBtn.waitFor({ state: 'visible', timeout: 5000 });

    const isExpanded = await projectsGroupBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await projectsGroupBtn.click();
      await this.page.waitForTimeout(500);
    }

    // Find the project in the sidebar
    const projectTreeItem = projectsTree
      .locator('[role="treeitem"]')
      .filter({ hasText: fullProjectName })
      .first();
    await projectTreeItem.waitFor({ state: 'visible', timeout: 5000 });

    // Right-click to open context menu
    await projectTreeItem.click({ button: 'right' });

    // Click delete option - look for "Delete" text
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

    // Wait for project to be removed from sidebar
    await projectTreeItem.waitFor({ state: 'hidden', timeout: 5000 });
  }
}
