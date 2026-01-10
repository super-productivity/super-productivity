# E2E Testing Guide for Super Productivity

This guide provides comprehensive information for writing and maintaining end-to-end tests for Super Productivity using Playwright.

## Table of Contents

- [Overview](#overview)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Page Objects](#page-objects)
- [Common Patterns](#common-patterns)
- [Selectors](#selectors)
- [Wait Utilities](#wait-utilities)
- [Writing New Tests](#writing-new-tests)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

Our E2E tests are built with Playwright and follow the Page Object Model (POM) pattern for maintainability and reusability. Tests are organized by feature and use shared fixtures for common setup.

### Key Technologies

- **Playwright**: Modern E2E testing framework
- **TypeScript**: Type-safe test code
- **Page Object Model**: Encapsulates page interactions
- **Fixtures**: Shared setup and utilities

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm run e2e

# Run tests in UI mode (interactive)
npm run e2e:ui

# Run a single test file with detailed output
npm run e2e:file tests/task-basic/task-crud.spec.ts

# Run tests in headed mode (see browser)
npm run e2e:headed

# Run tests in debug mode
npm run e2e:debug

# Show test report
npm run e2e:show-report
```

### WebDAV Sync Tests

```bash
# Run WebDAV tests (starts Docker container)
npm run e2e:webdav
```

---

## Test Structure

### Directory Layout

```
e2e/
├── constants/          # Shared selectors and constants
│   └── selectors.ts    # Centralized CSS selectors
├── fixtures/           # Test fixtures and setup
│   └── test.fixture.ts # Custom test fixtures with page objects
├── helpers/            # Test helper functions
│   └── plugin-test.helpers.ts
├── pages/              # Page Object Models
│   ├── base.page.ts    # Base page with common methods
│   ├── work-view.page.ts
│   ├── project.page.ts
│   ├── task.page.ts
│   ├── settings.page.ts
│   ├── dialog.page.ts
│   ├── planner.page.ts
│   ├── schedule.page.ts
│   ├── side-nav.page.ts
│   ├── sync.page.ts
│   ├── tag.page.ts
│   └── note.page.ts
├── tests/              # Test specifications
│   ├── task-basic/
│   ├── project/
│   ├── planner/
│   └── ...
├── utils/              # Utility functions
│   ├── waits.ts        # Wait helpers
│   └── sync-helpers.ts
├── playwright.config.ts
└── global-setup.ts
```

---

## Page Objects

Page Objects encapsulate interactions with specific pages or components. All page objects extend `BasePage` and receive a `page` and optional `testPrefix`.

### Available Page Objects

#### 1. **BasePage** (`base.page.ts`)

Base class for all page objects. Provides common functionality:

```typescript
class BasePage {
  async addTask(taskName: string): Promise<void>;
  // Adds a task with automatic test prefix
}
```

**Example:**

```typescript
await workViewPage.addTask('My Task');
// Creates task with name "W0-P0-My Task" (prefixed for isolation)
```

#### 2. **WorkViewPage** (`work-view.page.ts`)

Interactions with the main work view:

```typescript
class WorkViewPage extends BasePage {
  async waitForTaskList(): Promise<void>;
  async addSubTask(task: Locator, subTaskName: string): Promise<void>;
}
```

**Example:**

```typescript
await workViewPage.waitForTaskList();
await workViewPage.addTask('Parent Task');
const task = page.locator('task').first();
await workViewPage.addSubTask(task, 'Child Task');
```

#### 3. **TaskPage** (`task.page.ts`)

Task-specific operations:

```typescript
class TaskPage extends BasePage {
  getTask(index: number): Locator;
  getTaskByText(text: string): Locator;
  async markTaskAsDone(task: Locator): Promise<void>;
  async editTaskTitle(task: Locator, newTitle: string): Promise<void>;
  async openTaskDetail(task: Locator): Promise<void>;
  async getTaskCount(): Promise<number>;
  async isTaskDone(task: Locator): Promise<boolean>;
  getDoneTasks(): Locator;
  getUndoneTasks(): Locator;
  async waitForTaskWithText(text: string): Promise<Locator>;
  async taskHasTag(task: Locator, tagName: string): Promise<boolean>;
}
```

**Example:**

```typescript
const task = taskPage.getTask(1); // First task
await taskPage.markTaskAsDone(task);
await expect(taskPage.getDoneTasks()).toHaveCount(1);
```

#### 4. **ProjectPage** (`project.page.ts`)

Project management:

```typescript
class ProjectPage extends BasePage {
  async createProject(projectName: string): Promise<void>;
  async navigateToProjectByName(projectName: string): Promise<void>;
  async createAndGoToTestProject(): Promise<void>;
  async addNote(noteContent: string): Promise<void>;
  async archiveDoneTasks(): Promise<void>;
}
```

**Example:**

```typescript
await projectPage.createProject('My Project');
await projectPage.navigateToProjectByName('My Project');
await projectPage.addNote('Project notes here');
```

#### 5. **SettingsPage** (`settings.page.ts`)

Settings and configuration:

```typescript
class SettingsPage extends BasePage {
  async navigateToSettings(): Promise<void>;
  async expandSection(sectionSelector: string): Promise<void>;
  async expandPluginSection(): Promise<void>;
  async navigateToPluginSettings(): Promise<void>;
  async enablePlugin(pluginName: string): Promise<boolean>;
  async disablePlugin(pluginName: string): Promise<boolean>;
  async isPluginEnabled(pluginName: string): Promise<boolean>;
  async uploadPlugin(pluginPath: string): Promise<void>;
}
```

**Example:**

```typescript
await settingsPage.navigateToPluginSettings();
await settingsPage.enablePlugin('Test Plugin');
expect(await settingsPage.isPluginEnabled('Test Plugin')).toBeTruthy();
```

#### 6. **DialogPage** (`dialog.page.ts`)

Dialog and modal interactions:

```typescript
class DialogPage extends BasePage {
  async waitForDialog(): Promise<Locator>;
  async waitForDialogToClose(): Promise<void>;
  async clickDialogButton(buttonText: string): Promise<void>;
  async clickSaveButton(): Promise<void>;
  async fillDialogInput(selector: string, value: string): Promise<void>;
  async fillMarkdownDialog(content: string): Promise<void>;
  async saveMarkdownDialog(): Promise<void>;
  async editDateTime(dateValue?: string, timeValue?: string): Promise<void>;
}
```

**Example:**

```typescript
await dialogPage.waitForDialog();
await dialogPage.fillDialogInput('input[name="title"]', 'New Title');
await dialogPage.clickSaveButton();
await dialogPage.waitForDialogToClose();
```

---

## Common Patterns

### Pattern 1: Basic Task CRUD

```typescript
test('should create and edit task', async ({ page, workViewPage, taskPage }) => {
  await workViewPage.waitForTaskList();

  // Create
  await workViewPage.addTask('Test Task');
  await expect(taskPage.getAllTasks()).toHaveCount(1);

  // Edit
  const task = taskPage.getTask(1);
  await taskPage.editTaskTitle(task, 'Updated Task');
  await expect(taskPage.getTaskTitle(task)).toContainText('Updated Task');

  // Mark as done
  await taskPage.markTaskAsDone(task);
  await expect(taskPage.getDoneTasks()).toHaveCount(1);
});
```

### Pattern 2: Project Workflow

```typescript
test('should create project and add tasks', async ({ projectPage, workViewPage }) => {
  await projectPage.createAndGoToTestProject();
  await workViewPage.addTask('Project Task 1');
  await workViewPage.addTask('Project Task 2');
  await expect(page.locator('task')).toHaveCount(2);
});
```

### Pattern 3: Settings Configuration

```typescript
test('should enable plugin', async ({ settingsPage, waitForNav }) => {
  await settingsPage.navigateToPluginSettings();
  await settingsPage.enablePlugin('My Plugin');
  await waitForNav();
  expect(await settingsPage.isPluginEnabled('My Plugin')).toBeTruthy();
});
```

### Pattern 4: Dialog Interactions

```typescript
test('should edit date in dialog', async ({ taskPage, dialogPage }) => {
  const task = taskPage.getTask(1);
  await taskPage.openTaskDetail(task);

  const dateInfo = dialogPage.getDateInfo('Created');
  await dateInfo.click();
  await dialogPage.editDateTime('12/25/2025', undefined);
  await dialogPage.clickSaveButton();
});
```

---

## Selectors

All selectors are centralized in `constants/selectors.ts`. Always use these constants instead of hardcoding selectors in tests.

### Using Selectors

```typescript
import { cssSelectors } from '../constants/selectors';

const { TASK, TASK_TITLE, TASK_DONE_BTN } = cssSelectors;

// In test:
const task = page.locator(TASK).first();
const title = task.locator(TASK_TITLE);
```

### Selector Categories

- **Navigation**: `SIDENAV`, `NAV_ITEM`, `SETTINGS_BTN`
- **Layout**: `ROUTE_WRAPPER`, `BACKDROP`, `PAGE_TITLE`
- **Tasks**: `TASK`, `TASK_TITLE`, `TASK_DONE_BTN`, `SUB_TASK`
- **Add Task**: `ADD_TASK_INPUT`, `ADD_TASK_SUBMIT`
- **Dialogs**: `MAT_DIALOG`, `DIALOG_FULLSCREEN_MARKDOWN`
- **Settings**: `PAGE_SETTINGS`, `PLUGIN_SECTION`, `PLUGIN_MANAGEMENT`
- **Projects**: `PAGE_PROJECT`, `CREATE_PROJECT_BTN`, `WORK_CONTEXT_MENU`

---

## Wait Utilities

Located in `utils/waits.ts`, these utilities help handle Angular's async nature.

### Available Wait Functions

#### `waitForAngularStability(page, timeout?)`

Waits for Angular to finish all async operations.

```typescript
await waitForAngularStability(page);
```

#### `waitForAppReady(page, options?)`

Comprehensive wait for app initialization.

```typescript
await waitForAppReady(page, {
  selector: 'task-list',
  ensureRoute: true,
  routeRegex: /#\/project\/\w+/,
});
```

#### `waitForStatePersistence(page)`

Waits for IndexedDB persistence to complete (important before sync operations).

```typescript
await workViewPage.addTask('Task');
await waitForStatePersistence(page); // Ensure saved to IndexedDB
// Now safe to trigger sync
```

---

## Writing New Tests

### Step 1: Create Test File

```typescript
// e2e/tests/my-feature/my-feature.spec.ts
import { test, expect } from '../../fixtures/test.fixture';

test.describe('My Feature', () => {
  test('should do something', async ({ page, workViewPage, taskPage }) => {
    // Test code here
  });
});
```

### Step 2: Use Page Objects

```typescript
test('my test', async ({ workViewPage, taskPage, dialogPage }) => {
  // Wait for page ready
  await workViewPage.waitForTaskList();

  // Use page objects for interactions
  await workViewPage.addTask('Task 1');
  const task = taskPage.getTask(1);
  await taskPage.markTaskAsDone(task);

  // Assertions
  await expect(taskPage.getDoneTasks()).toHaveCount(1);
});
```

### Step 3: Handle Waits Properly

```typescript
// GOOD: Use Angular stability waits
await workViewPage.addTask('Task');
await waitForAngularStability(page);
await expect(page.locator('task')).toBeVisible();

// BAD: Arbitrary timeouts
await page.waitForTimeout(5000); // Avoid unless necessary
```

### Step 4: Use Selectors from Constants

```typescript
import { cssSelectors } from '../../constants/selectors';

const { TASK, TASK_TITLE } = cssSelectors;
const title = page.locator(TASK).first().locator(TASK_TITLE);
```

---

## Best Practices

### ✅ DO

1. **Use page objects** for all interactions
2. **Use centralized selectors** from `constants/selectors.ts`
3. **Wait for Angular stability** after state changes
4. **Use test prefixes** (automatic via fixtures) for isolation
5. **Test one thing per test** - keep tests focused
6. **Use descriptive test names** - "should create task and mark as done"
7. **Clean up state** - tests should be independent
8. **Use role-based selectors** when possible (accessibility)

```typescript
// GOOD
await page.getByRole('button', { name: 'Save' }).click();

// LESS GOOD
await page.locator('.save-btn').click();
```

### ❌ DON'T

1. **Don't hardcode selectors** - use `cssSelectors`
2. **Don't use arbitrary waits** - use `waitForAngularStability`
3. **Don't share state between tests** - each test should be independent
4. **Don't access DOM directly** - use page objects
5. **Don't skip error handling** - tests should fail clearly
6. **Don't use `any` types** - maintain type safety

### Test Isolation

Each test gets:

- Isolated browser context (clean storage)
- Unique test prefix (`W0-P0-`, `W1-P0-`, etc.)
- Fresh page instance

This ensures tests don't interfere with each other.

### Handling Flakiness

```typescript
// Use waitFor with explicit conditions
await page.waitForFunction(() => document.querySelectorAll('task').length === 3, {
  timeout: 10000,
});

// Use locator assertions (auto-retry)
await expect(page.locator('task')).toHaveCount(3);

// Avoid fixed timeouts
await page.waitForTimeout(1000); // BAD
await waitForAngularStability(page); // GOOD
```

---

## Troubleshooting

### Test Fails with "Element not found"

1. Check if selector is correct in `constants/selectors.ts`
2. Add wait before interaction: `await waitForAngularStability(page)`
3. Use `await element.waitFor({ state: 'visible' })`
4. Check if element is in a different context (iframe, shadow DOM)

### Test Timeout

1. Increase timeout in specific waitFor calls
2. Check if Angular is stuck - look for pending HTTP requests
3. Use `page.pause()` to debug interactively
4. Check network tab for failed requests

### Flaky Tests

1. Add proper waits: `waitForAngularStability`, `waitForAppReady`
2. Avoid `page.waitForTimeout()` - use condition-based waits
3. Check for race conditions - ensure state is persisted
4. Use `waitForStatePersistence` before operations that depend on saved state

### Debugging

```typescript
// Pause execution and open Playwright Inspector
await page.pause();

// Take screenshot
await page.screenshot({ path: 'debug.png' });

// Console log page content
console.log(await page.content());

// Get element text for debugging
const text = await page.locator('task').first().textContent();
console.log('Task text:', text);
```

### Running Single Test

```bash
# Run specific file
npm run e2e:file tests/task-basic/task-crud.spec.ts

# Run in debug mode
npm run e2e:debug

# Run in headed mode to see browser
npm run e2e:headed
```

---

## Examples

### Example 1: Full Task CRUD Test

```typescript
import { test, expect } from '../../fixtures/test.fixture';

test.describe('Task CRUD', () => {
  test('should create, edit, and delete tasks', async ({
    page,
    workViewPage,
    taskPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Create
    await workViewPage.addTask('Task 1');
    await workViewPage.addTask('Task 2');
    await expect(taskPage.getAllTasks()).toHaveCount(2);

    // Edit
    const firstTask = taskPage.getTask(1);
    await taskPage.editTaskTitle(firstTask, 'Updated Task');
    await expect(taskPage.getTaskTitle(firstTask)).toContainText('Updated Task');

    // Mark as done
    await taskPage.markTaskAsDone(firstTask);
    await expect(taskPage.getDoneTasks()).toHaveCount(1);
    await expect(taskPage.getUndoneTasks()).toHaveCount(1);
  });
});
```

### Example 2: Project Workflow

```typescript
test('should create project with tasks', async ({
  projectPage,
  workViewPage,
  taskPage,
}) => {
  await projectPage.createAndGoToTestProject();

  await workViewPage.addTask('Project Task');
  await projectPage.addNote('Important notes');

  const task = taskPage.getTask(1);
  await taskPage.markTaskAsDone(task);

  await projectPage.archiveDoneTasks();
  await expect(taskPage.getUndoneTasks()).toHaveCount(0);
});
```

### Example 3: Settings Test

```typescript
test('should configure plugin', async ({ settingsPage, page }) => {
  await settingsPage.navigateToPluginSettings();

  const pluginExists = await settingsPage.pluginExists('Test Plugin');
  expect(pluginExists).toBeTruthy();

  await settingsPage.enablePlugin('Test Plugin');
  expect(await settingsPage.isPluginEnabled('Test Plugin')).toBeTruthy();

  await settingsPage.navigateBackToWorkView();
  await expect(page).toHaveURL(/tag\/TODAY/);
});
```

---

## Getting Help

- Check existing tests in `e2e/tests/` for examples
- Review page objects in `e2e/pages/` for available methods
- Look at `constants/selectors.ts` for available selectors
- Use Playwright Inspector (`npm run e2e:debug`) for debugging
- Check Playwright docs: https://playwright.dev/

---

## Summary Checklist

When writing a new test:

- [ ] Create test file in appropriate `tests/` subdirectory
- [ ] Import `test` and `expect` from `fixtures/test.fixture.ts`
- [ ] Use page objects for all interactions
- [ ] Use selectors from `constants/selectors.ts`
- [ ] Add proper waits (`waitForAngularStability`, etc.)
- [ ] Use descriptive test names
- [ ] Ensure test is isolated (no shared state)
- [ ] Run test locally before committing
- [ ] Test passes consistently (run 3+ times)
