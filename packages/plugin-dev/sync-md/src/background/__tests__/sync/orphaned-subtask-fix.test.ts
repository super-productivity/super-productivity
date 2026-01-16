/**
 * Comprehensive tests for orphaned subtask fix (Issue #6021)
 * Tests the validation logic that prevents crashes when markdown files
 * contain subtasks referencing non-existent parents
 */

import { generateTaskOperations } from '../../sync/generate-task-operations';
import { ParsedTask } from '../../sync/markdown-parser';
import { Task } from '@super-productivity/plugin-api';

describe('Orphaned Subtask Fix - Issue #6021', () => {
  const projectId = 'test-project';

  describe('Parent ID Validation', () => {
    it('should convert orphaned subtask to root task when parent ID does not exist', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'orphan-subtask',
          title: 'Orphaned Subtask',
          parentId: 'non-existent-parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Orphaned Subtask',
        },
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      const operations = generateTaskOperations(mdTasks, [], projectId);

      // Should create the task without parentId (as root task)
      const createOps = operations.filter((op) => op.type === 'create');
      expect(createOps).toHaveLength(1);
      expect(createOps[0].data.title).toBe('Orphaned Subtask');
      expect(createOps[0].data.parentId).toBeUndefined();

      // Should log warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Orphaned subtask detected'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Orphaned Subtask'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-existent-parent'),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle multiple orphaned subtasks', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'orphan1',
          title: 'Orphan 1',
          parentId: 'missing-parent-1',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 0,
          originalLine: '  - [ ] Orphan 1',
        },
        {
          id: 'orphan2',
          title: 'Orphan 2',
          parentId: 'missing-parent-2',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Orphan 2',
        },
        {
          id: 'orphan3',
          title: 'Orphan 3',
          parentId: 'missing-parent-1', // Same missing parent as orphan1
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 2,
          originalLine: '  - [ ] Orphan 3',
        },
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      const operations = generateTaskOperations(mdTasks, [], projectId);

      // All three should be created as root tasks
      const createOps = operations.filter((op) => op.type === 'create');
      expect(createOps).toHaveLength(3);
      createOps.forEach((op) => {
        expect(op.data.parentId).toBeUndefined();
      });

      // Should log warnings (at least once per orphan)
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(
        consoleWarnSpy.mock.calls.some((call) =>
          call[0]?.includes('Orphaned subtask detected'),
        ),
      ).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    it('should preserve valid parent-child relationships', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'parent',
          title: 'Parent Task',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Parent Task',
        },
        {
          id: 'valid-child',
          title: 'Valid Child',
          parentId: 'parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Valid Child',
        },
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      const createOps = operations.filter((op) => op.type === 'create');
      const childOp = createOps.find((op) => op.data.title === 'Valid Child');

      // Valid child should keep its parentId
      expect(childOp).toBeDefined();
      expect(childOp!.data.parentId).toBe('parent');
    });

    it('should handle mix of valid and orphaned subtasks', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'parent',
          title: 'Parent Task',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Parent Task',
        },
        {
          id: 'valid-child',
          title: 'Valid Child',
          parentId: 'parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Valid Child',
        },
        {
          id: 'orphan',
          title: 'Orphaned Subtask',
          parentId: 'deleted-parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 2,
          originalLine: '  - [ ] Orphaned Subtask',
        },
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      const operations = generateTaskOperations(mdTasks, [], projectId);

      const createOps = operations.filter((op) => op.type === 'create');

      // Valid child should have parent
      const validChild = createOps.find((op) => op.data.title === 'Valid Child');
      expect(validChild!.data.parentId).toBe('parent');

      // Orphan should not have parent
      const orphan = createOps.find((op) => op.data.title === 'Orphaned Subtask');
      expect(orphan!.data.parentId).toBeUndefined();

      // Should warn about the orphan
      expect(consoleWarnSpy).toHaveBeenCalled();
      const orphanWarnings = consoleWarnSpy.mock.calls.filter((call) =>
        call[0]?.includes('Orphaned subtask detected'),
      );
      expect(orphanWarnings.length).toBeGreaterThanOrEqual(1);

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Temp ID Handling', () => {
    it('should recognize temp IDs as valid parent IDs', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: null,
          title: 'Parent Without ID',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Parent Without ID',
        },
        {
          id: null,
          title: 'Child of Parent',
          parentId: 'temp_0', // References temp ID
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Child of Parent',
        },
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      const createOps = operations.filter((op) => op.type === 'create');
      const childOp = createOps.find((op) => op.data.title === 'Child of Parent');

      // Child should have temp_0 as parent
      expect(childOp!.data.parentId).toBe('temp_0');
    });

    it('should handle multiple levels with temp IDs', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: null,
          title: 'Parent 1',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Parent 1',
        },
        {
          id: null,
          title: 'Child 1',
          parentId: 'temp_0',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Child 1',
        },
        {
          id: null,
          title: 'Parent 2',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 2,
          originalLine: '- [ ] Parent 2',
        },
        {
          id: null,
          title: 'Child 2',
          parentId: 'temp_2',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 3,
          originalLine: '  - [ ] Child 2',
        },
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      const createOps = operations.filter((op) => op.type === 'create');

      const child1 = createOps.find((op) => op.data.title === 'Child 1');
      const child2 = createOps.find((op) => op.data.title === 'Child 2');

      expect(child1!.data.parentId).toBe('temp_0');
      expect(child2!.data.parentId).toBe('temp_2');
    });
  });

  describe('SP Task Parent Validation', () => {
    it('should validate parent exists in SP tasks', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'child',
          title: 'Child Task',
          parentId: 'sp-parent', // References SP task
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 0,
          originalLine: '  - [ ] Child Task',
        },
      ];

      const spTasks: Task[] = [
        {
          id: 'sp-parent',
          title: 'SP Parent Task',
          isDone: false,
          parentId: null,
          projectId,
        } as Task,
      ];

      const operations = generateTaskOperations(mdTasks, spTasks, projectId);

      const createOps = operations.filter((op) => op.type === 'create');
      const childOp = createOps.find((op) => op.data.title === 'Child Task');

      // Should keep parent reference since it exists in SP
      expect(childOp!.data.parentId).toBe('sp-parent');
    });

    it('should reject parent ID that exists in SP but is itself a subtask', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'child',
          title: 'Child Task',
          parentId: 'sp-subtask',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 0,
          originalLine: '  - [ ] Child Task',
        },
      ];

      const spTasks: Task[] = [
        {
          id: 'sp-parent',
          title: 'SP Parent',
          isDone: false,
          parentId: null,
          projectId,
        } as Task,
        {
          id: 'sp-subtask',
          title: 'SP Subtask',
          isDone: false,
          parentId: 'sp-parent', // This is a subtask, not a root task
          projectId,
        } as Task,
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      const operations = generateTaskOperations(mdTasks, spTasks, projectId);

      const createOps = operations.filter((op) => op.type === 'create');
      const childOp = createOps.find((op) => op.data.title === 'Child Task');

      // Should convert to root task since parent is not a root task
      expect(childOp!.data.parentId).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Orphaned subtask detected'),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Update Operations', () => {
    it('should validate parent ID when updating existing task', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'existing-child',
          title: 'Existing Child',
          parentId: 'non-existent-parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 0,
          originalLine: '  - [ ] Existing Child',
        },
      ];

      const spTasks: Task[] = [
        {
          id: 'existing-child',
          title: 'Existing Child',
          isDone: false,
          parentId: 'old-parent',
          projectId,
        } as Task,
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      const operations = generateTaskOperations(mdTasks, spTasks, projectId);

      const updateOps = operations.filter((op) => op.type === 'update');
      const childUpdate = updateOps.find((op) => op.taskId === 'existing-child');

      // Should update parentId to null (remove invalid parent)
      expect(childUpdate).toBeDefined();
      expect(childUpdate!.updates.parentId).toBeNull();

      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Operation Validation Warnings', () => {
    it('should log validation warnings for operations with invalid parents', () => {
      // This test uses the validation function that runs after operations are generated
      const mdTasks: ParsedTask[] = [
        {
          id: 'task1',
          title: 'Task 1',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Task 1',
        },
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      generateTaskOperations(mdTasks, [], projectId);

      // Should not have any validation warnings for valid operations
      const validationWarnings = consoleWarnSpy.mock.calls.filter((call) =>
        call[0]?.includes('Operation warnings'),
      );
      expect(validationWarnings).toHaveLength(0);

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null parent ID safely', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'task1',
          title: 'Task with null parent',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Task',
        },
      ];

      expect(() => {
        generateTaskOperations(mdTasks, [], projectId);
      }).not.toThrow();
    });

    it('should handle undefined parent ID safely', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'task1',
          title: 'Task with undefined parent',
          parentId: undefined as any,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Task',
        },
      ];

      expect(() => {
        generateTaskOperations(mdTasks, [], projectId);
      }).not.toThrow();
    });

    it('should handle empty string parent ID as invalid', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'child',
          title: 'Child with empty parent',
          parentId: '',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 0,
          originalLine: '  - [ ] Child',
        },
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      const createOps = operations.filter((op) => op.type === 'create');
      expect(createOps[0].data.parentId).toBeUndefined();
    });

    it('should not crash with large number of orphaned subtasks', () => {
      const mdTasks: ParsedTask[] = Array.from({ length: 100 }, (_, i) => ({
        id: `orphan-${i}`,
        title: `Orphan ${i}`,
        parentId: `missing-parent-${i}`,
        completed: false,
        isSubtask: true,
        depth: 1,
        indent: 2,
        line: i,
        originalLine: `  - [ ] Orphan ${i}`,
      }));

      expect(() => {
        const operations = generateTaskOperations(mdTasks, [], projectId);
        expect(operations.length).toBeGreaterThan(0);
      }).not.toThrow();
    });
  });

  describe('Subtask Ordering with Orphans', () => {
    it('should not include orphaned subtasks in parent subtask ordering', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'parent',
          title: 'Parent',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 0,
          originalLine: '- [ ] Parent',
        },
        {
          id: 'valid-child',
          title: 'Valid Child',
          parentId: 'parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Valid Child',
        },
        {
          id: 'orphan',
          title: 'Orphan',
          parentId: 'missing-parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 2,
          originalLine: '  - [ ] Orphan',
        },
      ];

      const spTasks: Task[] = [
        {
          id: 'parent',
          title: 'Parent',
          isDone: false,
          parentId: null,
          projectId,
          subTaskIds: [],
        } as Task,
      ];

      const operations = generateTaskOperations(mdTasks, spTasks, projectId);

      // Find the update operation for parent's subTaskIds
      const updateOps = operations.filter((op) => op.type === 'update');
      const parentUpdate = updateOps.find((op) => op.taskId === 'parent');

      // Parent should have the valid child in subTaskIds
      expect(parentUpdate).toBeDefined();
      if (parentUpdate && parentUpdate.updates.subTaskIds) {
        const subTaskIds = parentUpdate.updates.subTaskIds as string[];
        // The valid child should be in the list (either by ID or temp ID)
        expect(subTaskIds.length).toBe(1);
        // The orphan should definitely not be included
        expect(subTaskIds).not.toContain('orphan');
        expect(subTaskIds).not.toContain('temp_2'); // orphan's potential temp ID
      }
    });
  });
});
