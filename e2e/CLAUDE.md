# E2E Test Reference

## Run Tests

```bash
npm run e2e:file tests/path/to/test.spec.ts   # Single test
npm run e2e                                    # All tests
```

## Test Template

```typescript
// Import path depends on test depth (see Import Paths below)
import { expect, test } from '../../fixtures/test.fixture';

test.describe('Feature', () => {
  test('should X when Y', async ({ workViewPage, taskPage }) => {
    await workViewPage.waitForTaskList();
    await workViewPage.addTask('Task Name');

    const task = taskPage.getTaskByText('Task Name');
    await expect(task).toBeVisible();
  });
});
```

## Import Paths

| Test Location                    | Import Path                      |
| -------------------------------- | -------------------------------- |
| `tests/feature/test.spec.ts`     | `../../fixtures/test.fixture`    |
| `tests/feature/sub/test.spec.ts` | `../../../fixtures/test.fixture` |

## All Fixtures

| Fixture        | Use For                                          |
| -------------- | ------------------------------------------------ |
| `workViewPage` | Task list, adding tasks                          |
| `taskPage`     | Task operations (get, edit, mark done)           |
| `projectPage`  | Project CRUD, navigation                         |
| `settingsPage` | Settings navigation, plugin management           |
| `dialogPage`   | Modal/dialog interactions                        |
| `plannerPage`  | Planner view operations                          |
| `syncPage`     | WebDAV sync setup                                |
| `tagPage`      | Tag management                                   |
| `notePage`     | Notes functionality                              |
| `sideNavPage`  | Side navigation                                  |
| `testPrefix`   | Auto-applied to task/project names for isolation |

## Assertion Helpers

```typescript
import {
  expectTaskCount,
  expectTaskVisible,
  expectTaskDone,
  expectDoneTaskCount,
  expectDialogVisible,
  expectNoGlobalError,
} from '../../utils/assertions';

// Usage:
await expectTaskCount(taskPage, 2);
await expectTaskVisible(taskPage, 'Task Name');
await expectTaskDone(taskPage, 'Task Name');
await expectDialogVisible(dialogPage);
await expectNoGlobalError(page);
```

## Common Patterns

### Create project with tasks

```typescript
await projectPage.createAndGoToTestProject();
await workViewPage.addTask('Task 1');
await workViewPage.addTask('Task 2');
await expectTaskCount(taskPage, 2);
```

### Mark task done and verify

```typescript
await workViewPage.addTask('My Task');
const task = taskPage.getTaskByText('My Task');
await taskPage.markTaskAsDone(task);
await expectDoneTaskCount(taskPage, 1);
```

### Dialog interaction

```typescript
// Trigger dialog via some action, then:
await dialogPage.waitForDialog();
await dialogPage.fillDialogInput('input[name="title"]', 'Value');
await dialogPage.clickSaveButton();
await dialogPage.waitForDialogToClose();
```

### Sync tests (serial execution required)

```typescript
test.describe.configure({ mode: 'serial' });

test.describe('Sync Feature', () => {
  test('should sync data', async ({ syncPage, workViewPage }) => {
    // Sync tests require special setup - see sync-test-helpers.ts
  });
});
```

## Key Methods

### workViewPage

- `waitForTaskList()` - Call first in every test
- `addTask(name)` - Add task via global input

### taskPage

- `getTaskByText(text)` → Locator
- `getTask(index)` → Locator (1-based)
- `getAllTasks()` → Locator
- `markTaskAsDone(task)`
- `getTaskCount()` → number
- `getDoneTasks()` / `getUndoneTasks()` → Locator
- `waitForTaskWithText(text)` → Locator

### projectPage

- `createProject(name)`
- `navigateToProjectByName(name)`
- `createAndGoToTestProject()` - Quick setup

### settingsPage

- `navigateToPluginSettings()`
- `uploadPlugin(path)`, `enablePlugin(name)`, `pluginExists(name)`

### dialogPage

- `waitForDialog()` → Locator
- `clickDialogButton(text)`, `clickSaveButton()`
- `fillDialogInput(selector, value)`
- `waitForDialogToClose()`

For full method list, read the page object file: `e2e/pages/<name>.page.ts`

## Selectors

```typescript
import { cssSelectors } from '../../constants/selectors';
// Available: TASK, FIRST_TASK, TASK_TITLE, TASK_DONE_BTN, ADD_TASK_INPUT, MAT_DIALOG, SIDENAV, etc.
```

## Critical Rules

1. **Always start with** `await workViewPage.waitForTaskList()`
2. **Use page objects** - not raw `page.locator()` for common actions
3. **No `waitForTimeout()`** - use `expect().toBeVisible()` instead
4. **Tests are isolated** - each gets fresh browser context + IndexedDB
5. **Use assertion helpers** - for consistent, readable tests
