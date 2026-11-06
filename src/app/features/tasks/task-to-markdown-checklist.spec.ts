import { taskToMarkdownChecklist } from './task-to-markdown-checklist';
import { Task, TaskWithSubTasks } from './task.model';

const task = (title: string, isDone = false): Task => ({ title, isDone }) as Task;

const parent = (title: string, subTasks: Task[] = [], isDone = false): TaskWithSubTasks =>
  ({ title, isDone, subTasks }) as TaskWithSubTasks;

describe('taskToMarkdownChecklist', () => {
  it('should render a task without sub tasks as a single checklist item', () => {
    expect(taskToMarkdownChecklist(parent('Write docs'))).toBe('- [ ] Write docs');
  });

  it('should mark done tasks with [x]', () => {
    expect(taskToMarkdownChecklist(parent('Write docs', [], true))).toBe(
      '- [x] Write docs',
    );
  });

  it('should indent sub tasks and keep their done state', () => {
    const result = taskToMarkdownChecklist(
      parent('Ship feature', [task('Implement', true), task('Test')]),
    );

    expect(result).toBe('- [ ] Ship feature\n  - [x] Implement\n  - [ ] Test');
  });

  it('should collapse whitespace so a title cannot break the checklist', () => {
    expect(taskToMarkdownChecklist(parent(' Multi\nline   title '))).toBe(
      '- [ ] Multi line title',
    );
  });
});
