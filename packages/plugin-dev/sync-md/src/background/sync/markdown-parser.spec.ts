import {
  parseMarkdownWithErrors as parseTasks,
  parseMarkdownWithHeader,
} from './markdown-parser';

describe('markdown-parser', () => {
  describe('parseTasks', () => {
    it('should parse simple tasks without IDs', () => {
      const markdown = `- [ ] Task 1
- [ ] Task 2
- [x] Task 3 (completed)`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(3);
      expect(result.tasks[0]).toEqual({
        line: 0,
        indent: 0,
        completed: false,
        id: null,
        title: 'Task 1',
        originalLine: '- [ ] Task 1',
        parentId: null,
        isSubtask: false,
        depth: 0,
        notes: undefined,
      });
      expect(result.tasks[1]).toEqual({
        line: 1,
        indent: 0,
        completed: false,
        id: null,
        title: 'Task 2',
        originalLine: '- [ ] Task 2',
        parentId: null,
        isSubtask: false,
        depth: 0,
        notes: undefined,
      });
      expect(result.tasks[2]).toEqual({
        line: 2,
        indent: 0,
        completed: true,
        id: null,
        title: 'Task 3 (completed)',
        originalLine: '- [x] Task 3 (completed)',
        parentId: null,
        isSubtask: false,
        depth: 0,
        notes: undefined,
      });
    });

    it('should parse tasks with IDs', () => {
      const markdown = `- [ ] <!--id123--> Task with ID
- [x] <!--id456--> Completed task with ID`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(2);
      expect(result.tasks[0].id).toBe('id123');
      expect(result.tasks[0].title).toBe('Task with ID');
      expect(result.tasks[1].id).toBe('id456');
      expect(result.tasks[1].title).toBe('Completed task with ID');
    });

    it('should parse 2-space indented subtasks', () => {
      const markdown = `- [ ] Parent Task
  - [ ] Subtask 1
  - [ ] Subtask 2`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(3);
      expect(result.tasks[0].isSubtask).toBe(false);
      expect(result.tasks[0].parentId).toBe(null);

      expect(result.tasks[1].isSubtask).toBe(true);
      expect(result.tasks[1].parentId).toBe('temp_0'); // Parent doesn't have ID, so temp ID is used
      expect(result.tasks[1].depth).toBe(1);

      expect(result.tasks[2].isSubtask).toBe(true);
      expect(result.tasks[2].parentId).toBe('temp_0');
      expect(result.tasks[2].depth).toBe(1);
    });

    it('should parse 4-space indented subtasks', () => {
      const markdown = `- [ ] Parent Task
    - [ ] Subtask 1
    - [ ] Subtask 2
    - [ ] Subtask 3`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(4);
      expect(result.tasks[0].isSubtask).toBe(false);
      expect(result.tasks[0].parentId).toBe(null);

      // All subtasks should have parentId pointing to temp_0
      expect(result.tasks[1].isSubtask).toBe(true);
      expect(result.tasks[1].parentId).toBe('temp_0');
      expect(result.tasks[1].depth).toBe(1);

      expect(result.tasks[2].isSubtask).toBe(true);
      expect(result.tasks[2].parentId).toBe('temp_0');
      expect(result.tasks[2].depth).toBe(1);

      expect(result.tasks[3].isSubtask).toBe(true);
      expect(result.tasks[3].parentId).toBe('temp_0');
      expect(result.tasks[3].depth).toBe(1);
    });

    it('should handle mixed parent tasks and subtasks with 4-space indentation', () => {
      const markdown = `- [ ] <!--id1--> Parent 1
    - [ ] Subtask 1.1
    - [ ] Subtask 1.2
- [ ] Parent 2
    - [ ] Subtask 2.1`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(5);

      // Parent 1 with ID
      expect(result.tasks[0].id).toBe('id1');
      expect(result.tasks[0].parentId).toBe(null);

      // Subtasks of Parent 1
      expect(result.tasks[1].parentId).toBe('id1'); // Parent has real ID
      expect(result.tasks[2].parentId).toBe('id1');

      // Parent 2 without ID
      expect(result.tasks[3].id).toBe(null);
      expect(result.tasks[3].parentId).toBe(null);

      // Subtask of Parent 2
      expect(result.tasks[4].parentId).toBe('temp_3'); // Parent doesn't have ID, so temp ID
    });

    it('should parse task notes', () => {
      const markdown = `- [ ] Task with notes
  This is a note line
  Another note line
- [ ] Task without notes`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(2);
      expect(result.tasks[0].notes).toBe('This is a note line\nAnother note line');
      expect(result.tasks[1].notes).toBeUndefined();
    });

    it('should parse subtask notes with proper indentation', () => {
      const markdown = `- [ ] Parent Task
  - [ ] Subtask with notes
    This is a subtask note
    Another subtask note
  - [ ] Subtask without notes`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(3);
      expect(result.tasks[1].notes).toBe('This is a subtask note\nAnother subtask note');
      expect(result.tasks[2].notes).toBeUndefined();
    });

    it('should skip tasks with empty titles', () => {
      const markdown = `- [ ] Valid Task
- [ ] 
- [ ] Another Valid Task`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(2);
      expect(result.tasks[0].title).toBe('Valid Task');
      expect(result.tasks[1].title).toBe('Another Valid Task');
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('Skipping task with empty title');
    });

    it('should handle duplicate IDs', () => {
      const markdown = `- [ ] <!--duplicate--> Task 1
- [ ] <!--duplicate--> Task 2
- [ ] <!--unique--> Task 3`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(3);
      // First occurrence keeps the ID
      expect(result.tasks[0].id).toBe('duplicate');
      // Duplicate gets null ID
      expect(result.tasks[1].id).toBe(null);
      // Unique ID is preserved
      expect(result.tasks[2].id).toBe('unique');
    });

    it('should detect most common indent size', () => {
      const markdown = `- [ ] Parent 1
  - [ ] Subtask 1.1 (2 spaces)
  - [ ] Subtask 1.2 (2 spaces)
- [ ] Parent 2
    - [ ] Subtask 2.1 (4 spaces)
- [ ] Parent 3
  - [ ] Subtask 3.1 (2 spaces)`;

      const result = parseTasks(markdown);

      // Should detect 2 spaces as most common (3 occurrences vs 1)
      // Only depth 0 and 1 tasks are included, depth 2+ become notes
      expect(result.tasks.length).toBe(6); // Not 7, because 4-space subtask is too deep
      expect(result.tasks[1].depth).toBe(1); // 2 spaces / 2 = depth 1
      expect(result.tasks[2].depth).toBe(1); // 2 spaces / 2 = depth 1
      expect(result.tasks[3].title).toBe('Parent 2'); // 4-space subtask becomes note
      expect(result.tasks[3].notes).toContain('- [ ] Subtask 2.1 (4 spaces)');
      expect(result.tasks[5].depth).toBe(1); // 2 spaces / 2 = depth 1
    });

    it('should handle complex nested structure', () => {
      const markdown = `- [ ] <!--root1--> Root Task 1
  - [ ] <!--sub1--> Subtask 1.1
  - [ ] Subtask 1.2
    Note for subtask 1.2
- [ ] Root Task 2
  - [ ] <!--sub2--> Subtask 2.1
    Note line 1
    Note line 2
  - [ ] Subtask 2.2`;

      const result = parseTasks(markdown);

      expect(result.tasks.length).toBe(6);

      // Check parent-child relationships
      expect(result.tasks[1].parentId).toBe('root1');
      expect(result.tasks[2].parentId).toBe('root1');
      expect(result.tasks[4].parentId).toBe('temp_4');
      expect(result.tasks[5].parentId).toBe('temp_4');

      // Check notes
      expect(result.tasks[2].notes).toBe('Note for subtask 1.2');
      expect(result.tasks[4].notes).toBe('Note line 1\nNote line 2');
    });
  });

  describe('parseMarkdownWithHeader', () => {
    it('should extract header content before first task', () => {
      const markdown = `# My Tasks
This is a description of my tasks.

Some more text here.

- [ ] Task 1
- [ ] Task 2`;

      const result = parseMarkdownWithHeader(markdown);

      expect(result.header).toBe(
        '# My Tasks\nThis is a description of my tasks.\n\nSome more text here.\n\n',
      );
      expect(result.tasks.length).toBe(2);
      expect(result.tasks[0].title).toBe('Task 1');
      expect(result.tasks[1].title).toBe('Task 2');
    });

    it('should handle markdown with no header', () => {
      const markdown = `- [ ] Task 1
- [ ] Task 2`;

      const result = parseMarkdownWithHeader(markdown);

      expect(result.header).toBeUndefined();
      expect(result.tasks.length).toBe(2);
    });

    it('should handle markdown with only header and no tasks', () => {
      const markdown = `# My Header
This is just a header with no tasks.`;

      const result = parseMarkdownWithHeader(markdown);

      expect(result.header).toBe('# My Header\nThis is just a header with no tasks.');
      expect(result.tasks.length).toBe(0);
    });

    it('should preserve complex header with metadata', () => {
      const markdown = `---
title: My Project Tasks
date: 2024-01-01
tags: [project, tasks]
---

# Project Overview

This document contains all the tasks for my project.

## Important Notes
- Remember to check dependencies
- Update documentation

- [ ] Task 1
- [ ] Task 2`;

      const result = parseMarkdownWithHeader(markdown);

      expect(result.header).toBe(`---
title: My Project Tasks
date: 2024-01-01
tags: [project, tasks]
---

# Project Overview

This document contains all the tasks for my project.

## Important Notes
- Remember to check dependencies
- Update documentation

`);
      expect(result.tasks.length).toBe(2);
    });

    it('should handle empty lines before first task', () => {
      const markdown = `# Header


- [ ] Task 1`;

      const result = parseMarkdownWithHeader(markdown);

      expect(result.header).toBe('# Header\n\n\n');
      expect(result.tasks.length).toBe(1);
    });
  });
});
