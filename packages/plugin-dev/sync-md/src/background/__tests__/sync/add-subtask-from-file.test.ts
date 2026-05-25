import { parseMarkdown } from '../../sync/markdown-parser';
import { generateTaskOperations } from '../../sync/generate-task-operations';
import { convertTasksToMarkdown } from '../../sync/sp-to-md';
import { Task, BatchTaskCreate, BatchTaskUpdate } from '@super-productivity/plugin-api';
import { TaskBuilder } from '../test-utils';

/**
 * Tests for issue #6021: Sync.md crashes when adding subtask to markdown file directly.
 *
 * Scenario: User creates a task with subtask in SP, SP syncs to markdown.
 * User then adds a new subtask by editing the markdown file directly.
 * The MD→SP sync should create the new subtask without errors or oscillation.
 */
describe('Add subtask from markdown file (#6021)', () => {
  const PROJECT_ID = 'test-project';

  describe('parsing subtask added without ID', () => {
    it('should parse a new subtask added without an ID under an existing parent', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] <!--sub-1--> Existing Subtask',
        '  - [ ] New Subtask Added By User',
      ].join('\n');

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe('parent-1');
      expect(tasks[0].isSubtask).toBe(false);
      expect(tasks[1].id).toBe('sub-1');
      expect(tasks[1].isSubtask).toBe(true);
      expect(tasks[1].parentId).toBe('parent-1');
      expect(tasks[2].id).toBeNull();
      expect(tasks[2].isSubtask).toBe(true);
      expect(tasks[2].parentId).toBe('parent-1');
      expect(tasks[2].title).toBe('New Subtask Added By User');
    });

    it('should parse multiple new subtasks added without IDs', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] <!--sub-1--> Existing Subtask',
        '  - [ ] New Subtask 1',
        '  - [ ] New Subtask 2',
      ].join('\n');

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(4);
      expect(tasks[2].id).toBeNull();
      expect(tasks[2].parentId).toBe('parent-1');
      expect(tasks[3].id).toBeNull();
      expect(tasks[3].parentId).toBe('parent-1');
    });
  });

  describe('generating operations for new subtask', () => {
    it('should generate a create operation for a new subtask added to the file', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] <!--sub-1--> Existing Subtask',
        '  - [ ] New Subtask Added By User',
      ].join('\n');

      const parsedTasks = parseMarkdown(markdown);

      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('Existing Subtask')
          .withParentId('parent-1')
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      // Should have a create operation for the new subtask
      const createOps = operations.filter(
        (op) => op.type === 'create',
      ) as BatchTaskCreate[];
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.title).toBe('New Subtask Added By User');
      expect(createOps[0].data.parentId).toBe('parent-1');

      // Should NOT have any delete operations
      const deleteOps = operations.filter((op) => op.type === 'delete');
      expect(deleteOps).toHaveLength(0);
    });

    it('should update parent subTaskIds to include the new subtask', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] <!--sub-1--> Existing Subtask',
        '  - [ ] New Subtask',
      ].join('\n');

      const parsedTasks = parseMarkdown(markdown);

      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('Existing Subtask')
          .withParentId('parent-1')
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      // Should have an update for parent's subTaskIds including temp ID for new subtask
      const updateOps = operations.filter(
        (op) => op.type === 'update' && op.taskId === 'parent-1',
      ) as BatchTaskUpdate[];
      expect(updateOps.length).toBeGreaterThanOrEqual(1);

      // The parent's subTaskIds should include both sub-1 and temp_2 (line 2)
      const parentUpdate = updateOps.find((op) => op.updates.subTaskIds);
      expect(parentUpdate).toBeDefined();
      expect(parentUpdate!.updates.subTaskIds).toContain('sub-1');
      // New subtask gets a temp ID based on its line number
      expect(parentUpdate!.updates.subTaskIds!.some((id) => id.startsWith('temp_'))).toBe(
        true,
      );
    });

    it('should not generate spurious operations for existing tasks', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] <!--sub-1--> Existing Subtask',
        '  - [ ] New Subtask',
      ].join('\n');

      const parsedTasks = parseMarkdown(markdown);

      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('Existing Subtask')
          .withParentId('parent-1')
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      // Should NOT update existing subtask
      const sub1Updates = operations.filter(
        (op) => op.type === 'update' && op.taskId === 'sub-1',
      );
      expect(sub1Updates).toHaveLength(0);

      // Should NOT delete any tasks
      const deleteOps = operations.filter((op) => op.type === 'delete');
      expect(deleteOps).toHaveLength(0);
    });
  });

  describe('round-trip: SP→MD→SP with new subtask', () => {
    it('should produce stable output after one MD→SP + SP→MD round-trip', () => {
      // Step 1: Start with SP tasks (parent + 1 subtask)
      const spTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('Existing Subtask')
          .withParentId('parent-1')
          .build(),
      ];

      // Step 2: SP→MD generates the markdown
      const markdown = convertTasksToMarkdown(spTasks);
      expect(markdown).toContain('<!--parent-1-->');
      expect(markdown).toContain('<!--sub-1-->');

      // Step 3: User adds a new subtask to the markdown
      const editedMarkdown = markdown + '\n  - [ ] New Subtask By User';

      // Step 4: MD→SP parses and generates operations
      const parsedTasks = parseMarkdown(editedMarkdown);
      expect(parsedTasks).toHaveLength(3);

      const operations = generateTaskOperations(parsedTasks, spTasks, PROJECT_ID);

      // Should have exactly 1 create op for the new subtask
      const createOps = operations.filter(
        (op) => op.type === 'create',
      ) as BatchTaskCreate[];
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.title).toBe('New Subtask By User');
      expect(createOps[0].data.parentId).toBe('parent-1');

      // Step 5: Simulate what happens after the batch update -
      // SP now has 3 tasks, SP→MD generates markdown again
      const updatedSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1', 'new-sub-id'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('Existing Subtask')
          .withParentId('parent-1')
          .build(),
        new TaskBuilder()
          .withId('new-sub-id')
          .withTitle('New Subtask By User')
          .withParentId('parent-1')
          .build(),
      ];

      const finalMarkdown = convertTasksToMarkdown(updatedSpTasks);

      // Step 6: Parse the final markdown and check no more operations needed
      const finalParsed = parseMarkdown(finalMarkdown);
      const finalOps = generateTaskOperations(finalParsed, updatedSpTasks, PROJECT_ID);

      // Only reorder operations should remain (no creates, updates, or deletes)
      const nonReorderOps = finalOps.filter((op) => op.type !== 'reorder');
      expect(nonReorderOps).toHaveLength(0);
    });
  });

  describe('edge cases for subtask addition from file', () => {
    it('should handle subtask added at the beginning of subtask list', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] New First Subtask',
        '  - [ ] <!--sub-1--> Existing Subtask',
      ].join('\n');

      const parsedTasks = parseMarkdown(markdown);
      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('Existing Subtask')
          .withParentId('parent-1')
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      const createOps = operations.filter(
        (op) => op.type === 'create',
      ) as BatchTaskCreate[];
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.title).toBe('New First Subtask');
      expect(createOps[0].data.parentId).toBe('parent-1');
    });

    it('should handle subtask added between existing subtasks', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [ ] <!--sub-1--> First Subtask',
        '  - [ ] New Middle Subtask',
        '  - [ ] <!--sub-2--> Last Subtask',
      ].join('\n');

      const parsedTasks = parseMarkdown(markdown);
      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds(['sub-1', 'sub-2'])
          .build(),
        new TaskBuilder()
          .withId('sub-1')
          .withTitle('First Subtask')
          .withParentId('parent-1')
          .build(),
        new TaskBuilder()
          .withId('sub-2')
          .withTitle('Last Subtask')
          .withParentId('parent-1')
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      const createOps = operations.filter(
        (op) => op.type === 'create',
      ) as BatchTaskCreate[];
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.title).toBe('New Middle Subtask');

      // Parent's subTaskIds should preserve order: sub-1, temp, sub-2
      const parentUpdate = operations.find(
        (op) => op.type === 'update' && op.taskId === 'parent-1' && op.updates.subTaskIds,
      ) as BatchTaskUpdate | undefined;
      expect(parentUpdate).toBeDefined();
      const subIds = parentUpdate!.updates.subTaskIds!;
      expect(subIds[0]).toBe('sub-1');
      expect(subIds[1]).toMatch(/^temp_/);
      expect(subIds[2]).toBe('sub-2');
    });

    it('should handle completed subtask added from file', () => {
      const markdown = [
        '- [ ] <!--parent-1--> Parent Task',
        '  - [x] New Completed Subtask',
      ].join('\n');

      const parsedTasks = parseMarkdown(markdown);
      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('parent-1')
          .withTitle('Parent Task')
          .withSubTaskIds([])
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      const createOps = operations.filter(
        (op) => op.type === 'create',
      ) as BatchTaskCreate[];
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.title).toBe('New Completed Subtask');
      expect(createOps[0].data.isDone).toBe(true);
      expect(createOps[0].data.parentId).toBe('parent-1');
    });

    it('should handle adding a subtask to a task that previously had no subtasks', () => {
      const markdown = ['- [ ] <!--task-1--> Simple Task', '  - [ ] New Subtask'].join(
        '\n',
      );

      const parsedTasks = parseMarkdown(markdown);
      const existingSpTasks: Task[] = [
        new TaskBuilder()
          .withId('task-1')
          .withTitle('Simple Task')
          .withSubTaskIds([])
          .build(),
      ];

      const operations = generateTaskOperations(parsedTasks, existingSpTasks, PROJECT_ID);

      const createOps = operations.filter(
        (op) => op.type === 'create',
      ) as BatchTaskCreate[];
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.parentId).toBe('task-1');

      // No delete operations
      expect(operations.filter((op) => op.type === 'delete')).toHaveLength(0);
    });
  });
});
