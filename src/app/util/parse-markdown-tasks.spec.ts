import {
  convertToMarkdownNotes,
  parseMarkdownTasks,
  parseMarkdownTasksWithStructure,
} from './parse-markdown-tasks';

describe('parseMarkdownTasks', () => {
  it('should parse bullet list with dashes', () => {
    const input = `- something
- something else
- something what`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: false },
      { title: 'something else', isCompleted: false },
      { title: 'something what', isCompleted: false },
    ]);
  });

  it('should parse bullet list with asterisks', () => {
    const input = `* something
* something else
* something what`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: false },
      { title: 'something else', isCompleted: false },
      { title: 'something what', isCompleted: false },
    ]);
  });

  it('should parse checkbox list with unchecked items', () => {
    const input = `- [ ] something
- [ ] something else
- [ ] something what`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: false },
      { title: 'something else', isCompleted: false },
      { title: 'something what', isCompleted: false },
    ]);
  });

  it('should parse checkbox list with checked items', () => {
    const input = `- [x] something
- [x] something else
- [x] something what`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: true },
      { title: 'something else', isCompleted: true },
      { title: 'something what', isCompleted: true },
    ]);
  });

  it('should parse mixed checkbox list', () => {
    const input = `- [x] something
- [ ] something else
- [x] something what`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: true },
      { title: 'something else', isCompleted: false },
      { title: 'something what', isCompleted: true },
    ]);
  });

  it('should handle extra whitespace', () => {
    const input = `
    -   something  
    -      something else   
    -  something what
    `;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: false },
      { title: 'something else', isCompleted: false },
      { title: 'something what', isCompleted: false },
    ]);
  });

  it('should handle checkbox format without spaces in brackets', () => {
    const input = `-[x] something
-[x] something else
-[x] something what`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'something', isCompleted: true },
      { title: 'something else', isCompleted: true },
      { title: 'something what', isCompleted: true },
    ]);
  });

  it('should return null for non-list text', () => {
    const input = 'This is just regular text without any list formatting';
    const result = parseMarkdownTasks(input);
    expect(result).toBe(null);
  });

  it('should return null for empty input', () => {
    expect(parseMarkdownTasks('')).toBe(null);
  });

  it('should return null for null input', () => {
    expect(parseMarkdownTasks(null as any)).toBe(null);
  });

  it('should return null for undefined input', () => {
    expect(parseMarkdownTasks(undefined as any)).toBe(null);
  });

  it('should return null for mixed content', () => {
    const input = `- something
Some random text here
- something else`;
    const result = parseMarkdownTasks(input);
    expect(result).toBe(null);
  });

  it('should return null for empty list items', () => {
    const input = `- 
- 
- `;
    const result = parseMarkdownTasks(input);
    expect(result).toBe(null);
  });

  it('should parse list with various task titles', () => {
    const input = `- Task with numbers 123
- Task with special chars @#$%
- Task with [brackets] and (parentheses)
- Task with "quotes" and 'apostrophes'`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'Task with numbers 123', isCompleted: false },
      { title: 'Task with special chars @#$%', isCompleted: false },
      { title: 'Task with [brackets] and (parentheses)', isCompleted: false },
      { title: 'Task with "quotes" and \'apostrophes\'', isCompleted: false },
    ]);
  });

  it('should parse nested list and add nested items as notes', () => {
    const input = `* main task
* main task 2
  * sub task 1
  * sub task 2
    * sub task 2 notes`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'main task', isCompleted: false },
      {
        title: 'main task 2',
        isCompleted: false,
        notes: '  - [ ] sub task 1\n  - [ ] sub task 2\n    - [ ] sub task 2 notes',
      },
    ]);
  });

  it('should parse mixed nested list with checkboxes', () => {
    const input = `- [x] completed main task
- [ ] main task with nested
  - [x] completed sub task
  - [ ] incomplete sub task
    - more nested item`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      { title: 'completed main task', isCompleted: true },
      {
        title: 'main task with nested',
        isCompleted: false,
        notes:
          '  - [x] completed sub task\n  - [ ] incomplete sub task\n    - [ ] more nested item',
      },
    ]);
  });

  it('should handle single level nested items', () => {
    const input = `* parent task
  * child 1
  * child 2`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      {
        title: 'parent task',
        isCompleted: false,
        notes: '  - [ ] child 1\n  - [ ] child 2',
      },
    ]);
  });

  it('should handle multiple top-level tasks with nested items', () => {
    const input = `* task 1
  * subtask 1a
* task 2
  * subtask 2a
  * subtask 2b
* task 3`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      {
        title: 'task 1',
        isCompleted: false,
        notes: '  - [ ] subtask 1a',
      },
      {
        title: 'task 2',
        isCompleted: false,
        notes: '  - [ ] subtask 2a\n  - [ ] subtask 2b',
      },
      { title: 'task 3', isCompleted: false },
    ]);
  });

  it('should handle deeply nested items', () => {
    const input = `* main task
  * level 1
    * level 2
      * level 3
        * level 4`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      {
        title: 'main task',
        isCompleted: false,
        notes:
          '  - [ ] level 1\n    - [ ] level 2\n      - [ ] level 3\n        - [ ] level 4',
      },
    ]);
  });

  it('should handle tab-based indentation', () => {
    const input = `* main task
\t* tab indented
\t\t* double tab indented`;
    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      {
        title: 'main task',
        isCompleted: false,
        notes: '\t- [ ] tab indented\n\t\t- [ ] double tab indented',
      },
    ]);
  });
});

describe('parseMarkdownTasksWithStructure', () => {
  it('should parse simple nested list into main tasks with sub-tasks', () => {
    const input = `* main task
  * sub task 1
  * sub task 2`;

    const result = parseMarkdownTasksWithStructure(input);
    expect(result).toEqual({
      mainTasks: [
        {
          title: 'main task',
          isCompleted: false,
          subTasks: [
            { title: 'sub task 1', isCompleted: false },
            { title: 'sub task 2', isCompleted: false },
          ],
        },
      ],
      totalSubTasks: 2,
    });
  });

  it('should parse multiple main tasks with nested sub-tasks', () => {
    const input = `* main task 1
  * sub task 1
  * sub task 2
* main task 2
  * sub task 3`;

    const result = parseMarkdownTasksWithStructure(input);
    expect(result).toEqual({
      mainTasks: [
        {
          title: 'main task 1',
          isCompleted: false,
          subTasks: [
            { title: 'sub task 1', isCompleted: false },
            { title: 'sub task 2', isCompleted: false },
          ],
        },
        {
          title: 'main task 2',
          isCompleted: false,
          subTasks: [{ title: 'sub task 3', isCompleted: false }],
        },
      ],
      totalSubTasks: 3,
    });
  });

  it('should handle deeply nested items with sub-task notes', () => {
    const input = `* main task
  * sub task 1
    * deep note 1
    * deep note 2
  * sub task 2`;

    const result = parseMarkdownTasksWithStructure(input);
    expect(result).toEqual({
      mainTasks: [
        {
          title: 'main task',
          isCompleted: false,
          subTasks: [
            {
              title: 'sub task 1',
              isCompleted: false,
              notes: '    - [ ] deep note 1\n    - [ ] deep note 2',
            },
            { title: 'sub task 2', isCompleted: false },
          ],
        },
      ],
      totalSubTasks: 2,
    });
  });

  it('should return structure with 0 sub-tasks for non-nested simple lists', () => {
    const input = `* task 1
* task 2
* task 3`;

    const result = parseMarkdownTasksWithStructure(input);
    // Should return a structure but with 0 sub-tasks
    expect(result).toEqual({
      mainTasks: [
        { title: 'task 1', isCompleted: false },
        { title: 'task 2', isCompleted: false },
        { title: 'task 3', isCompleted: false },
      ],
      totalSubTasks: 0,
    });
  });

  it('should handle mixed main tasks where only some have sub-tasks', () => {
    const input = `* main task
* main task 2
    * sub task 1
    * sub task 2
        * sub task 2 notes`;

    const result = parseMarkdownTasksWithStructure(input);
    expect(result).toEqual({
      mainTasks: [
        { title: 'main task', isCompleted: false },
        {
          title: 'main task 2',
          isCompleted: false,
          subTasks: [
            { title: 'sub task 1', isCompleted: false },
            {
              title: 'sub task 2',
              isCompleted: false,
              notes: '        - [ ] sub task 2 notes',
            },
          ],
        },
      ],
      totalSubTasks: 2,
    });
  });

  // Tripwire: once a sub-task level is set, a later nested item at a *shallower*
  // (but still > 0) level breaks out of the walk and is dropped here, whereas
  // parseMarkdownTasks keeps it as a note (see the matching test below). This
  // documents the divergence that a future shared top-level walker must
  // preserve.
  it('drops a nested item that dips below the first sub-task level', () => {
    const input = `* main
    * deep
  * shallow`;

    const result = parseMarkdownTasksWithStructure(input);
    expect(result).toEqual({
      mainTasks: [
        {
          title: 'main',
          isCompleted: false,
          subTasks: [{ title: 'deep', isCompleted: false }],
        },
      ],
      totalSubTasks: 1,
    });
  });

  it('keeps the same dip-below item as a note in parseMarkdownTasks', () => {
    const input = `* main
    * deep
  * shallow`;

    const result = parseMarkdownTasks(input);
    expect(result).toEqual([
      {
        title: 'main',
        isCompleted: false,
        notes: '    - [ ] deep\n  - [ ] shallow',
      },
    ]);
  });
});

describe('convertToMarkdownNotes', () => {
  it('should convert a dash bullet list to checkbox notes', () => {
    expect(convertToMarkdownNotes('- a\n- b')).toBe('- [ ] a\n- [ ] b');
  });

  it('should convert asterisk bullets to checkbox notes', () => {
    expect(convertToMarkdownNotes('* a\n* b')).toBe('- [ ] a\n- [ ] b');
  });

  it('should preserve completion state', () => {
    expect(convertToMarkdownNotes('- [x] done\n- [ ] todo')).toBe(
      '- [x] done\n- [ ] todo',
    );
  });

  it('should preserve absolute leading indentation, not dedent', () => {
    // Unlike the structured parsers, convertToMarkdownNotes keeps raw
    // whitespace: a uniformly-indented block must NOT be normalized to level 0.
    expect(convertToMarkdownNotes('  * parent\n    * child')).toBe(
      '  - [ ] parent\n    - [ ] child',
    );
  });

  it('should preserve tab indentation and brackets without spaces', () => {
    expect(convertToMarkdownNotes('-[x] a\n\t* b')).toBe('- [x] a\n\t- [ ] b');
  });

  it('should return null when any line is not a list item', () => {
    expect(convertToMarkdownNotes('- a\nplain text')).toBe(null);
  });

  it('should return null for empty, null and undefined input', () => {
    expect(convertToMarkdownNotes('')).toBe(null);
    expect(convertToMarkdownNotes(null as any)).toBe(null);
    expect(convertToMarkdownNotes(undefined as any)).toBe(null);
  });
});

// Exercises the shared parseLines / splitMarkdownLines setup that all three
// exported parsers now route through.
describe('shared input handling', () => {
  it('should normalize CRLF line endings', () => {
    expect(parseMarkdownTasks('- a\r\n- b')).toEqual([
      { title: 'a', isCompleted: false },
      { title: 'b', isCompleted: false },
    ]);
  });

  it('should strip a leading BOM', () => {
    expect(parseMarkdownTasks('\uFEFF- a\n- b')).toEqual([
      { title: 'a', isCompleted: false },
      { title: 'b', isCompleted: false },
    ]);
  });

  it('should reject input over the max length but accept input at the limit', () => {
    const overMax = '- ' + 'a'.repeat(800_001); // length 800003
    expect(parseMarkdownTasks(overMax)).toBe(null);
    expect(parseMarkdownTasksWithStructure(overMax)).toBe(null);
    expect(convertToMarkdownNotes(overMax)).toBe(null);

    // Boundary: length exactly MAX_INPUT_LENGTH must still parse (guard is `>`).
    const atMax = '- ' + 'a'.repeat(799_998);
    expect(atMax.length).toBe(800_000);
    expect(parseMarkdownTasks(atMax)).not.toBeNull();
  });
});
