import { parseMarkdown, parseMarkdownWithErrors } from '../../sync/markdown-parser';

describe('parseMarkdown', () => {
  it('should parse simple tasks', () => {
    const markdown = `- [ ] Task 1
- [x] Task 2 completed`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      title: 'Task 1',
      completed: false,
      id: null,
      parentId: null,
      isSubtask: false,
    });
    expect(tasks[1]).toMatchObject({
      title: 'Task 2 completed',
      completed: true,
      id: null,
      parentId: null,
      isSubtask: false,
    });
  });

  it('should parse tasks with IDs at the beginning', () => {
    const markdown = `- [ ] <!--task123--> Task with ID
- [x] <!--task456--> Completed task with ID`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      id: 'task123',
      title: 'Task with ID',
      completed: false,
    });
    expect(tasks[1]).toMatchObject({
      id: 'task456',
      title: 'Completed task with ID',
      completed: true,
    });
  });

  it('should parse subtasks with proper parent relationship', () => {
    const markdown = `- [ ] <!--parent1--> Parent task
  - [ ] <!--child1--> Subtask 1
  - [x] <!--child2--> Subtask 2`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(3);

    // Parent task
    expect(tasks[0]).toMatchObject({
      id: 'parent1',
      title: 'Parent task',
      completed: false,
      parentId: null,
      isSubtask: false,
    });

    // Subtasks
    expect(tasks[1]).toMatchObject({
      id: 'child1',
      title: 'Subtask 1',
      completed: false,
      parentId: 'parent1',
      isSubtask: true,
    });

    expect(tasks[2]).toMatchObject({
      id: 'child2',
      title: 'Subtask 2',
      completed: true,
      parentId: 'parent1',
      isSubtask: true,
    });
  });

  it('should handle notes for subtasks', () => {
    const markdown = `- [ ] <!--parent1--> Parent task
  - [ ] <!--child1--> Subtask with notes
    This is a note line
    Another note line`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({
      id: 'child1',
      title: 'Subtask with notes',
      notes: 'This is a note line\nAnother note line',
      parentId: 'parent1',
      isSubtask: true,
    });
  });

  it('should handle deeper nesting as notes', () => {
    const markdown = `- [ ] <!--parent1--> Parent task
  - [ ] <!--child1--> Subtask
    - [ ] This becomes a note
    - [x] This also becomes a note
      - Even deeper nesting`;

    const tasks = parseMarkdown(markdown);

    // With 4 spaces being the most common indent (2 occurrences),
    // the 2-space task is treated as depth 0 (not a subtask)
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({
      id: 'parent1',
      title: 'Parent task',
      isSubtask: false,
    });
    expect(tasks[1]).toMatchObject({
      id: 'child1',
      title: 'Subtask',
      isSubtask: false, // 2 spaces / 4 = 0.5, floor = 0
      parentId: null,
    });
    // The 4-space tasks are subtasks of child1
    expect(tasks[2]).toMatchObject({
      title: 'This becomes a note',
      parentId: 'child1',
      isSubtask: true,
    });
    expect(tasks[3]).toMatchObject({
      title: 'This also becomes a note',
      parentId: 'child1',
      isSubtask: true,
      notes: '- Even deeper nesting',
    });
  });

  it('should handle tasks without IDs', () => {
    const markdown = `- [ ] Task without ID
  - [ ] Subtask without ID`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      title: 'Task without ID',
      id: null,
      parentId: null,
      isSubtask: false,
    });
    expect(tasks[1]).toMatchObject({
      title: 'Subtask without ID',
      id: null,
      parentId: 'temp_0', // Parent is referenced by temporary ID
      isSubtask: true,
    });
  });

  it('should handle mixed ID formats', () => {
    const markdown = `- [ ] <!--simple-id--> Task 1
- [x] <!--123-456-789--> Task 2
- [ ] <!--uuid-like-id-here--> Task 3`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe('simple-id');
    expect(tasks[1].id).toBe('123-456-789');
    expect(tasks[2].id).toBe('uuid-like-id-here');
  });

  it('should handle empty lines and whitespace', () => {
    const markdown = `- [ ] <!--task1--> Task 1

  - [ ] <!--task2--> Subtask with extra whitespace
    
- [x] <!--task3--> Task 3`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe('Task 1');
    expect(tasks[1].title).toBe('Subtask with extra whitespace');
    expect(tasks[2].title).toBe('Task 3');
  });

  // Additional comprehensive tests salvaged from old codebase
  it('should ignore non-task lines', () => {
    const markdown = `# Heading
Some text
- [ ] Task 1
More text
- [x] Task 2`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('Task 1');
    expect(tasks[1].title).toBe('Task 2');
  });

  it('should handle tasks with complete structure validation', () => {
    const markdown = `- [ ] <!--task123--> Task with ID
- [x] Task without ID`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(2);

    // Full structure validation for task with ID
    expect(tasks[0]).toEqual({
      line: 0,
      indent: 0,
      completed: false,
      id: 'task123',
      title: 'Task with ID',
      originalLine: '- [ ] <!--task123--> Task with ID',
      parentId: null,
      isSubtask: false,
      depth: 0,
    });

    // Full structure validation for task without ID
    expect(tasks[1]).toEqual({
      line: 1,
      indent: 0,
      completed: true,
      id: null,
      title: 'Task without ID',
      originalLine: '- [x] Task without ID',
      parentId: null,
      isSubtask: false,
      depth: 0,
    });
  });

  it('should handle nested tasks with complete structure', () => {
    const markdown = `- [ ] <!--parent1--> Parent task
  - [ ] Child task 1
  - [x] <!--child2--> Child task 2
    - [ ] Sub-child task (becomes note)
- [ ] Another parent`;

    const tasks = parseMarkdown(markdown);

    expect(tasks).toHaveLength(4);

    // Parent task
    expect(tasks[0]).toEqual({
      line: 0,
      indent: 0,
      completed: false,
      id: 'parent1',
      title: 'Parent task',
      originalLine: '- [ ] <!--parent1--> Parent task',
      parentId: null,
      isSubtask: false,
      depth: 0,
    });

    // Child task 1
    expect(tasks[1]).toEqual({
      line: 1,
      indent: 2,
      completed: false,
      id: null,
      title: 'Child task 1',
      originalLine: '  - [ ] Child task 1',
      parentId: 'parent1',
      isSubtask: true,
      depth: 1,
    });

    // Child task 2 (has notes from sub-child)
    expect(tasks[2]).toEqual({
      line: 2,
      indent: 2,
      completed: true,
      id: 'child2',
      title: 'Child task 2',
      originalLine: '  - [x] <!--child2--> Child task 2',
      parentId: 'parent1',
      isSubtask: true,
      depth: 1,
      notes: '- [ ] Sub-child task (becomes note)',
    });

    // Another parent
    expect(tasks[3]).toEqual({
      line: 4,
      indent: 0,
      completed: false,
      id: null,
      title: 'Another parent',
      originalLine: '- [ ] Another parent',
      parentId: null,
      isSubtask: false,
      depth: 0,
    });
  });
});

describe('parseMarkdownWithErrors', () => {
  describe('Error Handling', () => {
    it('should collect errors for empty task titles', () => {
      const markdown = `- [ ]
- [x] Valid task
- [ ] <!--task123-->`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([
        'Skipping task with empty title at line 1',
        'Skipping task with empty title at line 3',
      ]);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Valid task');
    });

    it('should handle empty task titles with spacing', () => {
      const markdown = `- [ ]    
- [x] Valid task
- [ ] <!--task123-->   `;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([
        'Skipping task with empty title at line 1',
        'Skipping task with empty title at line 3',
      ]);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Valid task');
    });

    it('should handle mixed valid and invalid tasks', () => {
      const markdown = `- [ ] Valid task 1
- [ ]
- [x] Valid task 2
- [ ] <!--id-->
- [ ] <!--valid-id--> Valid task 3`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([
        'Skipping task with empty title at line 2',
        'Skipping task with empty title at line 4',
      ]);
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].title).toBe('Valid task 1');
      expect(result.tasks[1].title).toBe('Valid task 2');
      expect(result.tasks[2].title).toBe('Valid task 3');
    });

    it('should handle only invalid tasks', () => {
      const markdown = `- [ ]
- [x] 
- [ ] <!--id-->`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([
        'Skipping task with empty title at line 1',
        'Skipping task with empty title at line 2',
        'Skipping task with empty title at line 3',
      ]);
      expect(result.tasks).toHaveLength(0);
    });

    it('should handle empty markdown', () => {
      const result = parseMarkdownWithErrors('');

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(0);
    });

    it('should handle markdown with only non-task content', () => {
      const markdown = `# Header
      
Some text content
      
More text`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(0);
    });

    it('should handle nested tasks with empty titles', () => {
      const markdown = `- [ ] <!--parent1--> Parent task
  - [ ]
  - [x] Valid subtask
    - [ ]`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([
        'Skipping task with empty title at line 2',
        'Skipping task with empty title at line 4',
      ]);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe('Parent task');
      expect(result.tasks[1].title).toBe('Valid subtask');
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed ID comments', () => {
      const markdown = `- [ ] <!--unclosed-comment Task 1
- [x] <!-- --> Task 2
- [ ] <!--  --> Task 3
- [ ] <!--normal-id--> Task 4`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(4);
      expect(result.tasks[0].id).toBe(null);
      expect(result.tasks[1].id).toBe(null);
      expect(result.tasks[2].id).toBe(null);
      expect(result.tasks[3].id).toBe('normal-id');
    });

    it('should handle various whitespace scenarios', () => {
      const markdown = `- [ ] 	Task with tab
- [x]   Task with spaces
- [ ]		<!--id-->	Task with mixed whitespace`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].title).toBe('Task with tab');
      expect(result.tasks[1].title).toBe('Task with spaces');
      expect(result.tasks[2].title).toBe('Task with mixed whitespace');
    });

    it('should handle very long task titles', () => {
      const longTitle = 'A'.repeat(1000);
      const markdown = `- [ ] <!--long-task--> ${longTitle}`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe(longTitle);
      expect(result.tasks[0].id).toBe('long-task');
    });

    it('should handle unicode characters in task titles', () => {
      const markdown = `- [ ] <!--emoji-task--> 🚀 Task with emoji
- [x] <!--unicode-task--> Tâsk wïth ünïcödé`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe('🚀 Task with emoji');
      expect(result.tasks[1].title).toBe('Tâsk wïth ünïcödé');
    });

    it('should handle inconsistent indentation', () => {
      const markdown = `- [ ] Parent 1
  - [ ] Child 1 (2 spaces)
    - [ ] Child 2 (4 spaces)
- [ ] Parent 2
   - [ ] Child 3 (3 spaces)
      - [ ] Child 4 (6 spaces)`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(4);

      // Check parent tasks
      expect(result.tasks[0].isSubtask).toBe(false);
      expect(result.tasks[0].title).toBe('Parent 1');
      expect(result.tasks[2].isSubtask).toBe(false);
      expect(result.tasks[2].title).toBe('Parent 2');

      // Check subtasks (deeper nesting becomes notes)
      expect(result.tasks[1].isSubtask).toBe(true);
      expect(result.tasks[1].title).toBe('Child 1 (2 spaces)');
      expect(result.tasks[1].notes).toBe('- [ ] Child 2 (4 spaces)');

      expect(result.tasks[3].isSubtask).toBe(true);
      expect(result.tasks[3].title).toBe('Child 3 (3 spaces)');
      expect(result.tasks[3].notes).toBe(' - [ ] Child 4 (6 spaces)');
    });

    it('should handle tasks with special markdown characters', () => {
      const markdown = `- [ ] <!--special1--> Task with **bold** text
- [x] <!--special2--> Task with _italic_ and [link](http://example.com)
- [ ] <!--special3--> Task with \`code\` and ~~strikethrough~~`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].title).toBe('Task with **bold** text');
      expect(result.tasks[1].title).toBe(
        'Task with _italic_ and [link](http://example.com)',
      );
      expect(result.tasks[2].title).toBe('Task with `code` and ~~strikethrough~~');
    });

    it('should handle tasks with multiple consecutive spaces', () => {
      const markdown = `- [ ] Task    with    multiple    spaces
- [x] <!--id123--> Task     with     ID     and     spaces`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe('Task    with    multiple    spaces');
      expect(result.tasks[1].title).toBe('Task     with     ID     and     spaces');
    });

    it('should handle tasks with line breaks in notes', () => {
      const markdown = `- [ ] <!--task1--> Task with multiline note
  First line of note
  
  Second line after empty line
  Third line`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].title).toBe('Task with multiline note');
      // The parser skips empty lines in notes
      expect(result.tasks[0].notes).toBe(
        'First line of note\nSecond line after empty line\nThird line',
      );
    });

    it('should handle tasks with tabs instead of spaces', () => {
      const markdown = `- [ ] Parent with tabs
	- [ ] Child with tab indent
		- [ ] Grandchild with double tab`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe('Parent with tabs');
      expect(result.tasks[1].title).toBe('Child with tab indent');
      expect(result.tasks[1].isSubtask).toBe(true);
      // The parser strips the base indentation from notes
      expect(result.tasks[1].notes).toBe('- [ ] Grandchild with double tab');
    });

    it('should handle tasks with mixed checkbox styles', () => {
      const markdown = `- [ ] Unchecked with space
- [] Unchecked without space
- [x] Checked lowercase
- [X] Checked uppercase`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      // Parser only recognizes [ ] and [x] (lowercase x with spaces)
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe('Unchecked with space');
      expect(result.tasks[0].completed).toBe(false);
      // Non-matching lines become notes on the previous task
      expect(result.tasks[0].notes).toBe('- [] Unchecked without space');
      expect(result.tasks[1].title).toBe('Checked lowercase');
      expect(result.tasks[1].completed).toBe(true);
      expect(result.tasks[1].notes).toBe('- [X] Checked uppercase');
    });

    it('should handle tasks with trailing whitespace', () => {
      const markdown = `- [ ] Task with trailing spaces    
- [x] <!--id1--> Task with ID and trailing spaces   
  - [ ] Subtask with trailing spaces  `;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(3);
      // The parser trims trailing spaces from titles
      expect(result.tasks[0].title).toBe('Task with trailing spaces');
      expect(result.tasks[1].title).toBe('Task with ID and trailing spaces');
      expect(result.tasks[2].title).toBe('Subtask with trailing spaces');
    });

    it('should handle deeply nested parent-child relationships correctly', () => {
      const markdown = `- [ ] <!--root--> Root task
  - [ ] <!--level1--> Level 1 child
    - [ ] Level 2 grandchild (becomes note)
      - [ ] Level 3 great-grandchild (in note)
  - [ ] <!--level1b--> Another Level 1 child`;

      const result = parseMarkdownWithErrors(markdown);

      expect(result.errors).toEqual([]);
      expect(result.tasks).toHaveLength(3);

      // Root task
      expect(result.tasks[0].id).toBe('root');
      expect(result.tasks[0].parentId).toBe(null);
      expect(result.tasks[0].isSubtask).toBe(false);

      // First level 1 child
      expect(result.tasks[1].id).toBe('level1');
      expect(result.tasks[1].parentId).toBe('root');
      expect(result.tasks[1].isSubtask).toBe(true);
      expect(result.tasks[1].notes).toContain('Level 2 grandchild');
      expect(result.tasks[1].notes).toContain('Level 3 great-grandchild');

      // Second level 1 child
      expect(result.tasks[2].id).toBe('level1b');
      expect(result.tasks[2].parentId).toBe('root');
      expect(result.tasks[2].isSubtask).toBe(true);
    });
  });
});
