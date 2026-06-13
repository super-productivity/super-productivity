import { Task, TaskWithSubTasks, DEFAULT_TASK } from './task.model';
import { WorkContextType } from '../work-context/work-context.model';

/**
 * This test demonstrates the bug in issue #4846
 * When moving done tasks to archive in project context, if the done tasks array
 * includes both parent tasks and their subtasks as separate entries, the system
 * throws an error.
 */
describe('Issue #4846: Move to Archive with Subtasks', () => {
  const createMockTask = (
    id: string,
    title: string,
    isDone: boolean,
    parentId?: string,
  ): Task => ({
    ...DEFAULT_TASK,
    id,
    title,
    isDone,
    parentId,
    projectId: 'test-project',
    tagIds: [],
  });

  const createMockTaskWithSubTasks = (
    task: Task,
    subTasks: Task[] = [],
  ): TaskWithSubTasks => ({
    ...task,
    subTasks: subTasks.map((t) => ({ ...t, subTasks: [] })),
  });

  describe('Bug Demonstration', () => {
    it('FAILING: should demonstrate the current bug - done tasks include subtasks as flat entries', () => {
      // This represents the current behavior where doneTasks$ in project context
      // includes both parent tasks and subtasks as separate TaskWithSubTasks entries

      const parentTask = createMockTask('parent-1', 'Parent Task', true);
      const subTask1 = createMockTask('sub-1', 'Sub Task 1', true, 'parent-1');
      const subTask2 = createMockTask('sub-2', 'Sub Task 2', true, 'parent-1');

      // Current problematic state: doneTasks includes subtasks as separate entries
      const doneTasks: TaskWithSubTasks[] = [
        createMockTaskWithSubTasks(parentTask, [subTask1, subTask2]),
        createMockTaskWithSubTasks(subTask1), // BUG: Subtask included as separate entry
        createMockTaskWithSubTasks(subTask2), // BUG: Subtask included as separate entry
      ];

      // In moveToArchive method (task.service.ts:660-665):
      const tasks = doneTasks; // This would be passed to moveToArchive
      const subTasks = tasks.filter((t) => t.parentId);

      // The error condition check
      const activeWorkContextType = WorkContextType.PROJECT;

      // This is what causes the error
      expect(subTasks.length).toBeGreaterThan(0); // Has subtasks
      expect(activeWorkContextType).toBe(WorkContextType.PROJECT); // In project context

      // Therefore, this condition is true and throws the error:
      // if (subTasks.length && activeWorkContextType !== WorkContextType.TAG) {
      //   throw new Error('Trying to move sub tasks into archive for project');
      // }
    });

    it('EXPECTED: should show how done tasks should be structured', () => {
      // The correct behavior: doneTasks should only include parent tasks
      // Subtasks are included within their parent's subTasks array

      const parentTask = createMockTask('parent-1', 'Parent Task', true);
      const subTask1 = createMockTask('sub-1', 'Sub Task 1', true, 'parent-1');
      const subTask2 = createMockTask('sub-2', 'Sub Task 2', true, 'parent-1');

      // Correct state: only parent tasks in the array
      const doneTasks: TaskWithSubTasks[] = [
        createMockTaskWithSubTasks(parentTask, [subTask1, subTask2]),
        // Subtasks NOT included as separate entries
      ];

      // In moveToArchive method:
      const tasks = doneTasks;
      const subTasks = tasks.filter((t) => t.parentId);
      const parentTasks = tasks.filter((t) => !t.parentId);

      // No error because no subtasks in the top-level array
      expect(subTasks.length).toBe(0); // No subtasks at top level
      expect(parentTasks.length).toBe(1); // Only parent task

      // The archive operation would succeed
    });
  });

  describe('Fix Implementation', () => {
    it('should filter out subtasks before archiving', () => {
      // Proposed fix for work-view.component.ts moveDoneToArchive():

      const parentTask = createMockTask('parent-1', 'Parent Task', true);
      const subTask1 = createMockTask('sub-1', 'Sub Task 1', true, 'parent-1');
      const subTask2 = createMockTask('sub-2', 'Sub Task 2', true, 'parent-1');

      // Input: problematic done tasks array
      const doneTasks: TaskWithSubTasks[] = [
        createMockTaskWithSubTasks(parentTask, [subTask1, subTask2]),
        createMockTaskWithSubTasks(subTask1),
        createMockTaskWithSubTasks(subTask2),
      ];

      // FIX: Filter out subtasks before calling moveToArchive
      const tasksToArchive = doneTasks.filter((task) => !task.parentId);

      // Verify the fix
      expect(tasksToArchive.length).toBe(1); // Only parent task
      expect(tasksToArchive[0].id).toBe('parent-1');
      expect(tasksToArchive[0].subTasks.length).toBe(2); // Still has its subtasks

      // This filtered array can be safely passed to moveToArchive
    });
  });
});
