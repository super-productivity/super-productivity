import { sortWorklogEntriesAlphabetically } from './sort-worklog-entries';
import { WorklogDataForDay } from '../worklog.model';
import { Task } from '../../tasks/task.model';

const createMockTask = (overrides: Partial<Task>): Task =>
  ({
    id: 'test-id',
    title: 'Test Task',
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: true,
    notes: '',
    tagIds: [],
    created: 0,
    attachments: [],
    ...overrides,
  }) as Task;

const createEntry = (
  id: string,
  title: string,
  parentId?: string,
): WorklogDataForDay => ({
  timeSpent: 1000,
  task: createMockTask({ id, title, parentId }),
  parentId,
  isNoRestore: false,
});

describe('sortWorklogEntriesAlphabetically', () => {
  it('should return empty array for empty input', () => {
    expect(sortWorklogEntriesAlphabetically([])).toEqual([]);
  });

  it('should return single entry unchanged', () => {
    const entries = [createEntry('1', 'Task A')];
    const result = sortWorklogEntriesAlphabetically(entries);
    expect(result).toEqual(entries);
  });

  it('should sort parent tasks alphabetically', () => {
    const entries = [
      createEntry('1', 'Zebra'),
      createEntry('2', 'Apple'),
      createEntry('3', 'Banana'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual(['Apple', 'Banana', 'Zebra']);
  });

  it('should sort case-insensitively', () => {
    const entries = [
      createEntry('1', 'zebra'),
      createEntry('2', 'Apple'),
      createEntry('3', 'BANANA'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual(['Apple', 'BANANA', 'zebra']);
  });

  it('should keep subtasks grouped after their parent', () => {
    const entries = [
      createEntry('1', 'Zebra'),
      createEntry('1-sub', 'Sub-Z', '1'),
      createEntry('2', 'Apple'),
      createEntry('2-sub', 'Sub-A', '2'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual(['Apple', 'Sub-A', 'Zebra', 'Sub-Z']);
  });

  it('should sort subtasks alphabetically within their group', () => {
    const entries = [
      createEntry('1', 'Parent'),
      createEntry('1-c', 'Sub-C', '1'),
      createEntry('1-a', 'Sub-A', '1'),
      createEntry('1-b', 'Sub-B', '1'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual([
      'Parent',
      'Sub-A',
      'Sub-B',
      'Sub-C',
    ]);
  });

  it('should handle multiple parents with multiple subtasks', () => {
    const entries = [
      createEntry('zebra', 'Zebra'),
      createEntry('zebra-2', 'Sub-Z2', 'zebra'),
      createEntry('zebra-1', 'Sub-Z1', 'zebra'),
      createEntry('apple', 'Apple'),
      createEntry('apple-2', 'Sub-A2', 'apple'),
      createEntry('apple-1', 'Sub-A1', 'apple'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual([
      'Apple',
      'Sub-A1',
      'Sub-A2',
      'Zebra',
      'Sub-Z1',
      'Sub-Z2',
    ]);
  });

  it('should handle orphan subtasks (parent not in list)', () => {
    const entries = [
      createEntry('1', 'Parent A'),
      createEntry('orphan-1', 'Orphan Subtask 1', 'missing-parent'),
      createEntry('orphan-2', 'Orphan Subtask 2', 'missing-parent'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    // Orphan subtasks should come at the end, sorted alphabetically
    expect(result.map((e) => e.task.title)).toEqual([
      'Parent A',
      'Orphan Subtask 1',
      'Orphan Subtask 2',
    ]);
  });

  it('should sort orphan subtasks alphabetically among themselves', () => {
    const entries = [
      createEntry('1', 'Parent'),
      createEntry('orphan-b', 'Orphan B', 'missing'),
      createEntry('orphan-a', 'Orphan A', 'missing'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual(['Parent', 'Orphan A', 'Orphan B']);
  });

  it('should not mutate the original array', () => {
    const entries = [createEntry('1', 'Zebra'), createEntry('2', 'Apple')];
    const originalOrder = entries.map((e) => e.task.title);

    sortWorklogEntriesAlphabetically(entries);

    expect(entries.map((e) => e.task.title)).toEqual(originalOrder);
  });

  it('should handle entries with same title stably', () => {
    const entries = [
      createEntry('1', 'Same Title'),
      createEntry('2', 'Same Title'),
      createEntry('3', 'Same Title'),
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    // All should be present
    expect(result.length).toBe(3);
    expect(result.every((e) => e.task.title === 'Same Title')).toBe(true);
  });

  it('should handle mix of tasks with and without subtasks', () => {
    const entries = [
      createEntry('3', 'Charlie'), // standalone
      createEntry('1', 'Alpha'),
      createEntry('1-sub', 'Alpha Sub', '1'),
      createEntry('2', 'Bravo'), // standalone
    ];

    const result = sortWorklogEntriesAlphabetically(entries);

    expect(result.map((e) => e.task.title)).toEqual([
      'Alpha',
      'Alpha Sub',
      'Bravo',
      'Charlie',
    ]);
  });
});
