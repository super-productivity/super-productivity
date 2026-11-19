/**
 * Tests for no-sibling-feature-ui ESLint rule
 */
const { RuleTester } = require('eslint');
const rule = require('./no-sibling-feature-ui');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const TASK_CMP = '/repo/src/app/features/tasks/task/task.component.ts';
const WIN_TASK_CMP = 'C:\\repo\\src\\app\\features\\tasks\\task\\task.component.ts';

ruleTester.run('no-sibling-feature-ui', rule, {
  valid: [
    // Shared UI in src/app/ui
    {
      code: `import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';`,
      filename: TASK_CMP,
    },
    {
      code: `import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';`,
      filename: TASK_CMP,
    },
    // The feature's own pipes and components
    {
      code: `import { SubTaskTotalTimeSpentPipe } from '../pipes/sub-task-total-time-spent.pipe';`,
      filename: TASK_CMP,
    },
    {
      code: `import { TaskListComponent } from '../../tasks/task-list/task-list.component';`,
      filename: TASK_CMP,
    },
    // A sibling's service or model is not UI
    {
      code: `import { PlannerService } from '../../planner/planner.service';`,
      filename: TASK_CMP,
    },
    // Package imports
    {
      code: `import { Component } from '@angular/core';`,
      filename: TASK_CMP,
    },
    // Files outside src/app/features are not checked
    {
      code: `import { TagComponent } from '../features/tag/tag/tag.component';`,
      filename: '/repo/src/app/core/x.ts',
    },
  ],
  invalid: [
    // Sibling component and pipe, relative
    {
      code: `import { TagComponent } from '../../tag/tag/tag.component';`,
      filename: TASK_CMP,
      errors: [{ messageId: 'siblingUi', data: { own: 'tasks', other: 'tag' } }],
    },
    {
      code: `import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';`,
      filename: TASK_CMP,
      errors: [{ messageId: 'siblingUi', data: { own: 'tasks', other: 'issue' } }],
    },
    // Absolute (tsconfig baseUrl) form
    {
      code: `import { TagComponent } from 'src/app/features/tag/tag/tag.component';`,
      filename: TASK_CMP,
      errors: [{ messageId: 'siblingUi' }],
    },
    // Dynamic import, which no-restricted-imports cannot see
    {
      code: `const m = import('../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component');`,
      filename: TASK_CMP,
      errors: [
        { messageId: 'siblingUi', data: { own: 'tasks', other: 'task-repeat-cfg' } },
      ],
    },
    // Windows path separators
    {
      code: `import { TagComponent } from '../../tag/tag/tag.component';`,
      filename: WIN_TASK_CMP,
      errors: [{ messageId: 'siblingUi' }],
    },
  ],
});
