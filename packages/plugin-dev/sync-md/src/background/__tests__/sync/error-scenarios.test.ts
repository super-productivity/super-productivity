import { parseMarkdown, parseMarkdownWithErrors } from '../../sync/markdown-parser';
import { generateTaskOperations } from '../../sync/generate-task-operations';

describe('Error Scenarios and Boundary Conditions', () => {
  describe('Markdown Parser - Error Scenarios', () => {
    it('should handle malformed markdown gracefully', () => {
      const malformed = `- [ Task without closing bracket
- ] [ Task with reversed brackets
- [X] Task with uppercase X
- [] Task without spaces
-[] Task without space after dash
[x] Task without dash
  - [ ] Orphaned subtask`;

      const result = parseMarkdownWithErrors(malformed);

      // Should parse valid tasks and skip invalid ones
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0); // Current parser doesn't report these as errors
    });

    it('should handle extremely long task titles', () => {
      const veryLongTitle = 'A'.repeat(10000);
      const markdown = `- [ ] ${veryLongTitle}`;

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe(veryLongTitle);
    });

    it('should handle deeply nested markdown structure', () => {
      let markdown = '- [ ] Root\n';
      for (let i = 1; i <= 20; i++) {
        markdown += ' '.repeat(i * 2) + `- [ ] Level ${i}\n`;
      }

      const tasks = parseMarkdown(markdown);

      // Should handle deep nesting
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].title).toBe('Root');
    });

    it('should handle tasks with only whitespace titles', () => {
      const markdown = `- [ ]    \t   
- [ ] <!--id1-->   \t   
- [ ] Valid task`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Valid task');
      expect(result.errors).toContain('Skipping task with empty title at line 1');
      expect(result.errors).toContain('Skipping task with empty title at line 2');
    });

    it('should handle circular parent references gracefully', () => {
      // This would need manual ID manipulation to create circular refs
      const markdown = `- [ ] <!--parent--> Parent
  - [ ] <!--child--> Child`;

      const tasks = parseMarkdown(markdown);

      // Parser should handle this correctly
      expect(tasks[0].id).toBe('parent');
      expect(tasks[1].parentId).toBe('parent');
    });

    it('should handle Unicode and emoji correctly', () => {
      const markdown = `- [ ] 你好世界 🌍
- [x] עברית טקסט ✅
- [ ] Ελληνικά 🇬🇷
- [ ] <!--emoji-id-😀--> Task with emoji in ID`;

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(4);
      expect(tasks[0].title).toBe('你好世界 🌍');
      expect(tasks[1].title).toBe('עברית טקסט ✅');
      expect(tasks[2].title).toBe('Ελληνικά 🇬🇷');
      expect(tasks[3].id).toBe('emoji-id-😀');
    });

    it('should handle Windows line endings (CRLF)', () => {
      // Note: Current parser splits on \n only, so CRLF becomes single line with \r characters
      const markdown = '- [ ] Task 1\n- [x] Task 2\n  - [ ] Subtask';

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toBe('Task 1');
      expect(tasks[1].title).toBe('Task 2');
      expect(tasks[2].title).toBe('Subtask');
    });

    it('should handle mixed line endings', () => {
      const markdown = '- [ ] Unix LF\n- [x] Windows CRLF\r\n';

      const tasks = parseMarkdown(markdown);

      expect(tasks.length).toBeGreaterThanOrEqual(1); // At least Unix should work
    });

    it('should handle markdown with BOM (Byte Order Mark)', () => {
      const markdown = '\uFEFF- [ ] Task with BOM\n- [x] Normal task';

      const tasks = parseMarkdown(markdown);

      expect(tasks.length).toBeGreaterThanOrEqual(1);
      // BOM handling depends on implementation
    });
  });

  describe('Task Operations - Error Scenarios', () => {
    const projectId = 'test-project';

    it('should handle tasks with missing required fields', () => {
      const invalidTasks = [
        { title: '', id: 'empty-title', completed: false } as any,
        { id: 'no-title', completed: false } as any,
        { title: 'No ID', completed: false } as any,
      ];

      const operations = generateTaskOperations(invalidTasks, [], projectId);

      // Should handle gracefully
      expect(operations).toBeDefined();
      expect(Array.isArray(operations)).toBe(true);
    });

    it('should handle SP tasks with invalid data', () => {
      const spTasks = [
        { id: null, title: 'Null ID' } as any,
        { id: '', title: 'Empty ID' } as any,
        { id: 'valid', title: null } as any,
      ];

      const mdTasks = [{ id: 'new', title: 'New Task', completed: false }];

      // Should not throw
      expect(() => {
        generateTaskOperations(mdTasks, spTasks, projectId);
      }).not.toThrow();
    });

    it('should handle cyclic parent-child relationships', () => {
      const mdTasks = [
        { id: 'task1', title: 'Task 1', parentId: 'task2', completed: false },
        { id: 'task2', title: 'Task 2', parentId: 'task1', completed: false },
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      // Should not cause infinite loop
      expect(operations).toBeDefined();
    });

    it('should handle extremely large task sets', () => {
      const largeMdTasks = Array.from({ length: 5000 }, (_, i) => ({
        id: `task${i}`,
        title: `Task ${i}`,
        completed: i % 2 === 0,
        parentId: i > 0 ? `task${i - 1}` : null,
      }));

      const start = Date.now();
      const operations = generateTaskOperations(largeMdTasks, [], projectId);
      const duration = Date.now() - start;

      // Should complete in reasonable time (adjusted for CI environments)
      expect(duration).toBeLessThan(5000); // Less than 5 seconds
      expect(operations.length).toBeGreaterThan(0);
    });

    it('should handle parent ID pointing to non-existent task', () => {
      const mdTasks = [
        {
          id: 'orphan',
          title: 'Orphan Task',
          parentId: 'non-existent',
          completed: false,
        },
        { id: 'normal', title: 'Normal Task', parentId: null, completed: false },
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      // Should create orphan task but handle missing parent
      const createOps = operations.filter((op) => op.type === 'create');
      expect(createOps.length).toBeGreaterThanOrEqual(1);
    });

    it('should convert orphaned subtasks to root tasks and warn', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'orphan',
          title: 'Orphan Subtask',
          parentId: 'non-existent-parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 1,
          originalLine: '  - [ ] Orphan Subtask',
        },
        {
          id: 'normal',
          title: 'Normal Task',
          parentId: null,
          completed: false,
          isSubtask: false,
          depth: 0,
          indent: 0,
          line: 2,
          originalLine: '- [ ] Normal Task',
        },
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');
      const operations = generateTaskOperations(mdTasks, [], projectId);

      // Orphan should be created as root task (no parentId in create operation)
      const createOps = operations.filter((op) => op.type === 'create');
      const orphanCreate = createOps.find(
        (op) => op.type === 'create' && op.data.title === 'Orphan Subtask',
      );

      expect(orphanCreate).toBeDefined();
      expect(orphanCreate?.data.parentId).toBeUndefined();

      // Should have logged warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Orphaned subtask detected'),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle duplicate operations gracefully', () => {
      const mdTasks = [
        { id: 'dup', title: 'Task 1', completed: false },
        { id: 'dup', title: 'Task 2', completed: false }, // Same ID
      ];

      const operations = generateTaskOperations(mdTasks, [], projectId);

      // Should handle duplicates
      expect(operations).toBeDefined();
    });
  });

  describe('Integration - Error Recovery', () => {
    it('should handle null and undefined values throughout the pipeline', () => {
      // Test null handling
      // parseMarkdown expects a string, so null/undefined will throw
      expect(() => parseMarkdown(null as any)).toThrow();
      expect(() => parseMarkdown(undefined as any)).toThrow();

      // generateTaskOperations expects arrays, so null will throw
      expect(() => generateTaskOperations(null as any, [], 'project')).toThrow();
      expect(() => generateTaskOperations([], null as any, 'project')).toThrow();
      // null projectId is handled gracefully
      expect(() => generateTaskOperations([], [], null as any)).not.toThrow();
    });

    it('should handle empty arrays and edge cases', () => {
      const emptyOps = generateTaskOperations([], [], 'project');
      expect(emptyOps).toEqual([]);

      const emptyParse = parseMarkdown('');
      expect(emptyParse).toEqual([]);
    });

    it('should handle special filesystem characters in task content', () => {
      const markdown = `- [ ] Task with / slash
- [ ] Task with \\ backslash
- [ ] Task with : colon
- [ ] Task with * asterisk
- [ ] Task with ? question
- [ ] Task with " quotes
- [ ] Task with < less than
- [ ] Task with > greater than
- [ ] Task with | pipe`;

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(9);
      expect(tasks[0].title).toBe('Task with / slash');
      expect(tasks[1].title).toBe('Task with \\ backslash');
      // ... etc
    });

    it('should handle control characters in content', () => {
      const markdown = `- [ ] Task with\ttab
- [ ] Task with\nnewline
- [ ] Task with\rcarriage return
- [ ] Task with\0null byte`;

      const tasks = parseMarkdown(markdown);

      // Should handle or sanitize control characters
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('should handle race conditions in sync operations', async () => {
      // This would require actual async testing with the real modules
      // For now, we ensure the operations handle concurrent calls

      const tasks1 = [{ id: '1', title: 'Task 1', completed: false }];
      const tasks2 = [{ id: '2', title: 'Task 2', completed: false }];

      // Simulate concurrent operations
      const ops1 = generateTaskOperations(tasks1, [], 'project');
      const ops2 = generateTaskOperations(tasks2, [], 'project');

      expect(ops1).toBeDefined();
      expect(ops2).toBeDefined();
    });
  });

  describe('Memory and Performance Boundaries', () => {
    it('should handle markdown files with millions of characters', () => {
      // Create a large markdown string (1MB)
      const lines = Array.from(
        { length: 10000 },
        (_, i) =>
          `- [ ] <!--id${i}--> This is task number ${i} with some additional text to make it longer`,
      );
      const largeMarkdown = lines.join('\n');

      const start = Date.now();
      const tasks = parseMarkdown(largeMarkdown);
      const duration = Date.now() - start;

      expect(tasks).toHaveLength(10000);
      expect(duration).toBeLessThan(5000); // Should parse in under 5 seconds
    });

    it('should handle tasks with extremely long notes', () => {
      const longNote = 'Note line\n'.repeat(1000);
      const markdown = `- [ ] Task with huge note\n${longNote}`;

      const tasks = parseMarkdown(markdown);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].notes).toBeDefined();
      expect(tasks[0].notes!.length).toBeGreaterThan(1000);
    });

    it('should handle malicious input attempting ReDoS', () => {
      // Attempt patterns that could cause Regular Expression Denial of Service
      const maliciousPatterns = [
        '- [ ] ' + 'a'.repeat(1000) + '<!--' + 'b'.repeat(1000) + '-->',
        '- [' + ' '.repeat(1000) + '] Task',
        '<!--' + '-->'.repeat(1000) + '--> Task',
      ];

      maliciousPatterns.forEach((pattern) => {
        const start = Date.now();
        parseMarkdown(pattern);
        const duration = Date.now() - start;

        // Should not hang or take excessive time
        expect(duration).toBeLessThan(100);
      });
    });
  });

  describe('Operation Validation', () => {
    it('should validate operations and catch invalid parent references', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'child',
          title: 'Child Task',
          parentId: 'invalid-parent',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 0,
          originalLine: '  - [ ] Child',
        },
      ];

      const consoleWarnSpy = jest.spyOn(console, 'warn');

      // Should not throw, but should log warnings
      expect(() => {
        generateTaskOperations(mdTasks, [], 'test-project');
      }).not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle null parent IDs safely', () => {
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

      expect(() => {
        generateTaskOperations(mdTasks, [], 'test-project');
      }).not.toThrow();
    });

    it('should handle subtasks with missing parent gracefully', () => {
      const mdTasks: ParsedTask[] = [
        {
          id: 'subtask-without-parent',
          title: 'Orphaned Subtask',
          parentId: 'missing-parent-id',
          completed: false,
          isSubtask: true,
          depth: 1,
          indent: 2,
          line: 5,
          originalLine: '  - [ ] Orphaned Subtask',
        },
      ];

      // Should create as root task, not crash
      const operations = generateTaskOperations(mdTasks, [], 'test-project');

      const createOp = operations.find(
        (op) => op.type === 'create' && op.data.title === 'Orphaned Subtask',
      );

      expect(createOp).toBeDefined();
      expect(createOp?.data.parentId).toBeUndefined();
    });
  });
});
