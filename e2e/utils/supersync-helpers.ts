import {
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { SuperSyncPage, type SuperSyncConfig } from '../pages/supersync.page';
import { WorkViewPage } from '../pages/work-view.page';
import { waitForAppReady } from './waits';
import {
  HEALTH_CHECK_TIMEOUT,
  API_REQUEST_TIMEOUT,
  UI_VISIBLE_TIMEOUT,
  UI_VISIBLE_TIMEOUT_LONG,
  UI_SETTLE_SMALL,
  UI_SETTLE_MEDIUM,
  UI_SETTLE_STANDARD,
  UI_SETTLE_EXTENDED,
  RETRY_BASE_DELAY,
  TASK_POLL_INTERVAL,
  TASK_WAIT_TIMEOUT,
  UI_VISIBLE_TIMEOUT_SHORT,
} from './e2e-constants';

/**
 * SuperSync server URL for E2E tests.
 * Server must be running with TEST_MODE=true.
 * Defaults to port 1901 for e2e tests (dev server uses 1900).
 */
export const SUPERSYNC_BASE_URL =
  process.env.SUPERSYNC_E2E_URL || 'http://localhost:1901';

/**
 * Test user credentials returned from the server.
 */
export interface TestUser {
  email: string;
  token: string;
  userId: number;
}

/**
 * A simulated client for E2E sync tests.
 * Wraps a browser context, page, and page objects.
 */
export interface SimulatedE2EClient {
  context: BrowserContext;
  page: Page;
  workView: WorkViewPage;
  sync: SuperSyncPage;
  clientName: string;
}

/**
 * Create a test user on the SuperSync server.
 * Requires server to be running with TEST_MODE=true.
 *
 * @param testId - Unique test identifier for user email
 * @returns Test user with email and JWT token
 */
export const createTestUser = async (
  testId: string,
  maxRetries = 3,
): Promise<TestUser> => {
  const email = `test-${testId}@e2e.local`;
  const password = 'TestPassword123!';

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${SUPERSYNC_BASE_URL}/api/test/create-user`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });

    // Handle rate limiting with exponential backoff
    if (response.status === 429 && attempt < maxRetries - 1) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
      console.log(`[createTestUser] Rate limited (429), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create test user: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return {
      email,
      token: data.token,
      userId: data.userId,
    };
  }

  throw new Error(`Max retries (${maxRetries}) exceeded for createTestUser`);
};

/**
 * Clean up all test data on the server.
 * Call this in test teardown if needed.
 */
export const cleanupTestData = async (): Promise<void> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/test/cleanup`, {
    method: 'POST',
  });

  if (!response.ok) {
    console.warn(`Cleanup failed: ${response.status}`);
  }
};

/**
 * Delete a specific test user account on the SuperSync server.
 * Used to test account deletion and re-registration scenarios.
 *
 * @param userId - The user ID to delete
 */
export const deleteTestUser = async (userId: number): Promise<void> => {
  const response = await fetch(`${SUPERSYNC_BASE_URL}/api/test/user/${userId}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Failed to delete test user: ${response.status} - ${text}`);
  }
};

/**
 * Check if the SuperSync server is running, healthy, AND has test mode enabled.
 * Tests require TEST_MODE=true on the server for the /api/test/* endpoints.
 */
export const isServerHealthy = async (): Promise<boolean> => {
  try {
    // First check basic health
    const healthResponse = await fetch(`${SUPERSYNC_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
    });
    if (!healthResponse.ok) {
      return false;
    }

    // Then verify test mode is enabled by trying to create a dummy user
    // This is the only reliable way to check if test endpoints exist
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const testModeResponse = await fetch(`${SUPERSYNC_BASE_URL}/api/test/create-user`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: `health-check-${Date.now()}@test.local`,
        password: 'HealthCheck123!',
      }),
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT),
    });

    // If test mode is disabled, the route won't exist (404)
    // If test mode is enabled, we'll get 201 (created) or 409 (conflict) or similar
    if (testModeResponse.status === 404) {
      console.warn('SuperSync server is running but TEST_MODE is not enabled');
      return false;
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Get SuperSync configuration for a test user.
 */
export const getSuperSyncConfig = (user: TestUser): SuperSyncConfig => {
  return {
    baseUrl: SUPERSYNC_BASE_URL,
    accessToken: user.token,
  };
};

/**
 * Create a simulated E2E client with its own isolated browser context.
 *
 * Each client has:
 * - Separate browser context (isolated IndexedDB, localStorage)
 * - Unique clientId generated by the app on first load
 * - WorkViewPage for task operations
 * - SuperSyncPage for sync operations
 *
 * @param browser - Playwright browser instance
 * @param baseURL - App base URL (e.g., http://localhost:4242)
 * @param clientName - Human-readable name for debugging (e.g., "A", "B")
 * @param testPrefix - Test prefix for task naming
 */
export const createSimulatedClient = async (
  browser: Browser,
  baseURL: string,
  clientName: string,
  testPrefix: string,
): Promise<SimulatedE2EClient> => {
  // Use provided baseURL or fall back to localhost:4242 (Playwright fixture may be undefined)
  const effectiveBaseURL = baseURL || 'http://localhost:4242';

  const context = await browser.newContext({
    storageState: undefined, // Clean slate - no shared state
    userAgent: `PLAYWRIGHT SYNC-CLIENT-${clientName}`,
    baseURL: effectiveBaseURL,
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Set up error logging
  page.on('pageerror', (error) => {
    console.error(`[Client ${clientName}] Page error:`, error.message);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Client ${clientName}] Console error:`, msg.text());
    } else if (process.env.E2E_VERBOSE) {
      console.log(`[Client ${clientName}] Console ${msg.type()}:`, msg.text());
    }
  });

  // Navigate to app and wait for ready
  await page.goto('/');
  await waitForAppReady(page);

  const workView = new WorkViewPage(page, `${clientName}-${testPrefix}`);
  const sync = new SuperSyncPage(page);

  return {
    context,
    page,
    workView,
    sync,
    clientName,
  };
};

/**
 * Close a simulated client and clean up resources.
 * Safely handles already-closed contexts.
 */
export const closeClient = async (client: SimulatedE2EClient): Promise<void> => {
  try {
    // Check if page is still open before trying to close context
    if (!client.page.isClosed()) {
      // Add timeout wrapper to prevent cleanup from blocking test completion.
      // context.close() can hang waiting for trace files to be written.
      const closePromise = client.context.close();
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Cleanup timeout')), 5000),
      );
      await Promise.race([closePromise, timeoutPromise]);
    }
  } catch (error) {
    // Ignore errors if context is already closed or trace artifacts are missing.
    // Common scenarios:
    // - Test timeout: Playwright force-closes contexts, cleanup gets "Protocol error"
    // - ENOENT: Trace file finalization fails for manually-created contexts
    // - Context already closed: Race between test timeout and cleanup
    // - Cleanup timeout: context.close() hung waiting for trace artifacts
    if (error instanceof Error) {
      const ignorableErrors = [
        'Target page, context or browser has been closed',
        'ENOENT',
        'Protocol error',
        'Target.disposeBrowserContext',
        'Failed to find context',
        'End of central directory record signature not found',
        'Cleanup timeout',
      ];
      const shouldIgnore = ignorableErrors.some((msg) => error.message.includes(msg));
      if (shouldIgnore) {
        console.warn(`[closeClient] Ignoring cleanup error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
};

/**
 * Wait for a task with given name to appear on the page.
 * Uses longer timeout by default for sync operations which can be slow.
 * Includes retry logic for better reliability after sync operations.
 */
export const waitForTask = async (
  page: Page,
  taskName: string,
  timeout = TASK_WAIT_TIMEOUT,
): Promise<void> => {
  const escapedName = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startTime = Date.now();

  // Retry loop to handle DOM update delays
  while (Date.now() - startTime < timeout) {
    // Check if page is still open before each iteration
    if (page.isClosed()) {
      throw new Error(`Page was closed while waiting for task "${taskName}"`);
    }

    try {
      await page.waitForSelector(`task:has-text("${escapedName}")`, {
        timeout: UI_VISIBLE_TIMEOUT,
        state: 'visible',
      });
      return; // Success
    } catch {
      // Check if page is closed before waiting
      if (page.isClosed()) {
        throw new Error(`Page was closed while waiting for task "${taskName}"`);
      }
      // Wait a bit and retry
      await page.waitForTimeout(TASK_POLL_INTERVAL);
    }
  }

  // Final attempt with full remaining timeout
  if (page.isClosed()) {
    throw new Error(`Page was closed while waiting for task "${taskName}"`);
  }
  const remaining = Math.max(timeout - (Date.now() - startTime), RETRY_BASE_DELAY);
  await page.waitForSelector(`task:has-text("${escapedName}")`, {
    timeout: remaining,
    state: 'visible',
  });
};

/**
 * Count tasks matching a pattern on the page.
 */
export const countTasks = async (page: Page, pattern?: string): Promise<number> => {
  if (pattern) {
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return page.locator(`task:has-text("${escapedPattern}")`).count();
  }
  return page.locator('task').count();
};

/**
 * Check if a task exists on the page.
 */
export const hasTask = async (page: Page, taskName: string): Promise<boolean> => {
  const escapedName = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const count = await page.locator(`task:has-text("${escapedName}")`).count();
  return count > 0;
};

// ============================================================================
// Task Element Helpers
// ============================================================================

/**
 * Escape special characters in a string for use in CSS :has-text() selector.
 */
const escapeForSelector = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Get a task element locator by task name.
 * This replaces the common pattern: `client.page.locator(\`task:has-text("${taskName}")\`)`
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to search for
 * @returns Locator for the task element
 */
export const getTaskElement = (client: SimulatedE2EClient, taskName: string): Locator => {
  const escapedName = escapeForSelector(taskName);
  return client.page.locator(`task:has-text("${escapedName}")`);
};

/**
 * Get a task element locator from a page by task name.
 * Use this when you have a page but not a client.
 *
 * @param page - The Playwright page
 * @param taskName - The task name to search for
 * @returns Locator for the task element
 */
export const getTaskElementFromPage = (page: Page, taskName: string): Locator => {
  const escapedName = escapeForSelector(taskName);
  return page.locator(`task:has-text("${escapedName}")`);
};

/**
 * Get a subtask element (task without subtasks) by name.
 * Useful for targeting subtasks without matching their parent.
 *
 * @param client - The simulated E2E client
 * @param taskName - The subtask name to search for
 * @returns Locator for the subtask element
 */
export const getSubtaskElement = (
  client: SimulatedE2EClient,
  taskName: string,
): Locator => {
  const escapedName = escapeForSelector(taskName);
  return client.page.locator(`task.hasNoSubTasks:has-text("${escapedName}")`);
};

/**
 * Get a done task element by name.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to search for
 * @returns Locator for the done task element
 */
export const getDoneTaskElement = (
  client: SimulatedE2EClient,
  taskName: string,
): Locator => {
  const escapedName = escapeForSelector(taskName);
  return client.page.locator(`task.isDone:has-text("${escapedName}")`);
};

/**
 * Get a done subtask element by name.
 *
 * @param client - The simulated E2E client
 * @param taskName - The subtask name to search for
 * @returns Locator for the done subtask element
 */
export const getDoneSubtaskElement = (
  client: SimulatedE2EClient,
  taskName: string,
): Locator => {
  const escapedName = escapeForSelector(taskName);
  return client.page.locator(`task.hasNoSubTasks.isDone:has-text("${escapedName}")`);
};

/**
 * Get an undone subtask element by name.
 *
 * @param client - The simulated E2E client
 * @param taskName - The subtask name to search for
 * @returns Locator for the undone subtask element
 */
export const getUndoneSubtaskElement = (
  client: SimulatedE2EClient,
  taskName: string,
): Locator => {
  const escapedName = escapeForSelector(taskName);
  return client.page.locator(
    `task.hasNoSubTasks:not(.isDone):has-text("${escapedName}")`,
  );
};

/**
 * Get a parent task element (task with subtasks) by name.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to search for
 * @returns Locator for the parent task element
 */
export const getParentTaskElement = (
  client: SimulatedE2EClient,
  taskName: string,
): Locator => {
  const escapedName = escapeForSelector(taskName);
  return client.page.locator(`task:not(.hasNoSubTasks):has-text("${escapedName}")`);
};

// ============================================================================
// Task Action Helpers
// ============================================================================

/**
 * Mark a task as done by hovering and clicking the done button.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to mark as done
 */
export const markTaskDone = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  await task.hover();
  await task.locator('.task-done-btn').click();
};

/**
 * Mark a subtask as done by hovering and clicking the done button.
 * Uses getSubtaskElement to avoid matching parent tasks.
 *
 * @param client - The simulated E2E client
 * @param subtaskName - The subtask name to mark as done
 */
export const markSubtaskDone = async (
  client: SimulatedE2EClient,
  subtaskName: string,
): Promise<void> => {
  const subtask = getSubtaskElement(client, subtaskName);
  await subtask.hover();
  await subtask.locator('.task-done-btn').click();
};

/**
 * Expand a parent task to show its subtasks.
 *
 * @param client - The simulated E2E client
 * @param taskName - The parent task name
 */
export const expandTask = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  const expandBtn = task.locator('.expand-btn');
  if (await expandBtn.isVisible()) {
    await expandBtn.click();
  }
};

/**
 * Delete a task via keyboard shortcut (Backspace) and confirm if dialog appears.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to delete
 */
export const deleteTask = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  await task.click();
  await client.page.keyboard.press('Backspace');

  // Confirm deletion if dialog appears
  const confirmBtn = client.page.locator('mat-dialog-actions button:has-text("Delete")');
  if (
    await confirmBtn.isVisible({ timeout: UI_VISIBLE_TIMEOUT_SHORT }).catch(() => false)
  ) {
    await confirmBtn.click();
  }
  await client.page.waitForTimeout(UI_SETTLE_STANDARD);
};

/**
 * Rename a task by double-clicking and filling the input.
 *
 * @param client - The simulated E2E client
 * @param oldName - The current task name
 * @param newName - The new task name
 */
export const renameTask = async (
  client: SimulatedE2EClient,
  oldName: string,
  newName: string,
): Promise<void> => {
  const task = getTaskElement(client, oldName);
  await task.locator('task-title').click();
  await client.page.waitForSelector('task textarea', { state: 'visible' });
  await client.page.locator('task textarea').fill(newName);
  await client.page.keyboard.press('Tab');
  await client.page.waitForTimeout(UI_SETTLE_MEDIUM);
};

/**
 * Start time tracking on a task.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to start tracking
 */
export const startTimeTracking = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  await task.hover();
  const startBtn = task.locator('.start-task-btn');
  await startBtn.waitFor({ state: 'visible', timeout: UI_VISIBLE_TIMEOUT });
  await startBtn.click();
};

/**
 * Stop time tracking on a task.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to stop tracking
 */
export const stopTimeTracking = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  await task.hover();
  const pauseBtn = task.locator('button:has(mat-icon:has-text("pause"))');
  await pauseBtn.waitFor({ state: 'visible', timeout: UI_VISIBLE_TIMEOUT });
  await pauseBtn.click();
};

// ============================================================================
// Task Query Helpers
// ============================================================================

/**
 * Get the task count on a client.
 *
 * @param client - The simulated E2E client
 * @returns The number of tasks
 */
export const getTaskCount = async (client: SimulatedE2EClient): Promise<number> => {
  return client.page.locator('task').count();
};

/**
 * Get all task titles as an array.
 * Useful for comparing task order between clients.
 *
 * @param client - The simulated E2E client
 * @returns Array of task titles in order
 */
export const getTaskTitles = async (client: SimulatedE2EClient): Promise<string[]> => {
  const tasks = client.page.locator('task .task-title');
  const count = await tasks.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await tasks.nth(i).innerText();
    titles.push(text.trim());
  }
  return titles;
};

/**
 * Get the tracked time display text for a task.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name
 * @returns The time display text or null if not visible
 */
export const getTaskTimeDisplay = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<string | null> => {
  const task = getTaskElement(client, taskName);
  const timeVal = task.locator('.time-wrapper .time-val').first();
  if (await timeVal.isVisible()) {
    return timeVal.textContent();
  }
  return null;
};

/**
 * Check if a task has the given text (exists on client).
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to check
 * @returns true if the task exists
 */
export const hasTaskOnClient = async (
  client: SimulatedE2EClient,
  taskName: string,
): Promise<boolean> => {
  return hasTask(client.page, taskName);
};

// ============================================================================
// Test Setup Helpers
// ============================================================================

/**
 * Generate a unique test run ID for data isolation.
 * This replaces the common `generateTestRunId` function in test files.
 *
 * @param workerIndex - The Playwright worker index from testInfo
 * @returns A unique test run ID string
 */
export const generateTestRunId = (workerIndex: number): string => {
  return `${Date.now()}-${workerIndex}`;
};

// ============================================================================
// UI HELPERS - For direct DOM interactions during tests
// ============================================================================

/**
 * Reliably create a project through the UI.
 * Handles sidebar state, hover-to-reveal buttons, and dialog interaction.
 *
 * @param page - The Playwright page
 * @param projectName - The name for the new project
 */
export const createProjectReliably = async (
  page: Page,
  projectName: string,
): Promise<void> => {
  await page.goto('/#/tag/TODAY/work');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(UI_SETTLE_EXTENDED);

  // Ensure sidebar is in full mode (visible labels)
  const navSidenav = page.locator('.nav-sidenav');
  if (await navSidenav.isVisible()) {
    const isCompact = await navSidenav.evaluate((el) =>
      el.classList.contains('compactMode'),
    );
    if (isCompact) {
      const toggleBtn = navSidenav.locator('.mode-toggle');
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await page.waitForTimeout(UI_SETTLE_STANDARD);
      }
    }
  }

  // Find the Projects section wrapper
  const projectsTree = page
    .locator('nav-list-tree')
    .filter({ hasText: 'Projects' })
    .first();
  await projectsTree.waitFor({ state: 'visible' });

  // The "Create Project" button is an additional-btn with an 'add' icon
  const addBtn = projectsTree.locator('.additional-btn mat-icon:has-text("add")').first();

  if (await addBtn.isVisible()) {
    await addBtn.click();
  } else {
    // Try to hover the group header to make buttons appear
    const groupNavItem = projectsTree.locator('nav-item').first();
    await groupNavItem.hover();
    await page.waitForTimeout(UI_SETTLE_SMALL);
    if (await addBtn.isVisible()) {
      await addBtn.click();
    } else {
      throw new Error('Could not find Create Project button');
    }
  }

  // Dialog
  const nameInput = page.getByRole('textbox', { name: 'Project Name' });
  await nameInput.waitFor({ state: 'visible', timeout: UI_VISIBLE_TIMEOUT_LONG });
  await nameInput.fill(projectName);

  const submitBtn = page.locator('dialog-create-project button[type=submit]').first();
  await submitBtn.click();

  // Wait for dialog to close
  await nameInput.waitFor({ state: 'hidden', timeout: UI_VISIBLE_TIMEOUT });

  // Wait for project to appear
  await page.waitForTimeout(UI_SETTLE_EXTENDED);
};
