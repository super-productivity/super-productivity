import { Task, TaskWithSubTasks } from './task.model';

const SUB_TASK_INDENT = '  ';

// Titles are single-line in the UI, but short syntax and paste can smuggle in
// newlines — collapsing keeps every task on exactly one checklist line.
const toChecklistLine = (task: Task, indent: string): string =>
  `${indent}- [${task.isDone ? 'x' : ' '}] ${task.title.replace(/\s+/g, ' ').trim()}`;

/**
 * Render a task and its sub tasks as a markdown checklist, e.g.
 *
 * ```
 * - [ ] Parent
 *   - [x] Sub task
 * ```
 */
export const taskToMarkdownChecklist = (task: TaskWithSubTasks): string =>
  [
    toChecklistLine(task, ''),
    ...task.subTasks.map((subTask) => toChecklistLine(subTask, SUB_TASK_INDENT)),
  ].join('\n');
