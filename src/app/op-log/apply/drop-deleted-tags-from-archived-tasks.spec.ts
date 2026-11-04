import { dropDeletedTagsFromArchivedTasks } from './drop-deleted-tags-from-archived-tasks';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';

const task = (id: string, extra: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
  ({
    id,
    projectId: 'INBOX',
    parentId: undefined,
    tagIds: [],
    subTaskIds: [],
    subTasks: [],
    ...extra,
  }) as TaskWithSubTasks;

const subTask = (id: string, parentId: string, tagIds: string[]): Task =>
  ({ id, parentId, projectId: 'INBOX', tagIds, subTaskIds: [] }) as unknown as Task;

describe('dropDeletedTagsFromArchivedTasks', () => {
  const existing = new Set(['kept']);

  it('returns tasks untouched (same reference) when every tag still exists', () => {
    const t = task('t1', { tagIds: ['kept'] });
    const result = dropDeletedTagsFromArchivedTasks([t], existing);
    expect(result).toEqual([t]);
    expect(result[0]).toBe(t);
  });

  it('removes a tag id that no longer exists locally (#11466)', () => {
    const result = dropDeletedTagsFromArchivedTasks(
      [task('t1', { tagIds: ['deleted', 'kept'] })],
      existing,
    );
    expect(result.length).toBe(1);
    expect(result[0].tagIds).toEqual(['kept']);
  });

  it('keeps a task with a project when its only tag is gone', () => {
    const result = dropDeletedTagsFromArchivedTasks(
      [task('t1', { tagIds: ['deleted'] })],
      existing,
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
    expect(result[0].tagIds).toEqual([]);
  });

  it('removes deleted tag ids from subtasks', () => {
    const parent = task('p', {
      tagIds: ['kept'],
      subTaskIds: ['s1'],
      subTasks: [subTask('s1', 'p', ['deleted'])],
    });
    const result = dropDeletedTagsFromArchivedTasks([parent], existing);
    expect(result[0].tagIds).toEqual(['kept']);
    expect(result[0].subTasks.map((st) => st.tagIds)).toEqual([[]]);
    expect(result[0].subTaskIds).toEqual(['s1']);
  });

  it('keeps a root task orphaned by the removal, like removeTagsFromAllTasks does', () => {
    const orphan = task('o', {
      projectId: '',
      tagIds: ['deleted'],
      subTaskIds: ['s1'],
      subTasks: [subTask('s1', 'o', [])],
    });
    const other = task('t2', { tagIds: ['kept'] });
    const result = dropDeletedTagsFromArchivedTasks([orphan, other], existing);
    expect(result.map((t) => t.id)).toEqual(['o', 't2']);
    expect(result[0].tagIds).toEqual([]);
    expect(result[0].subTasks.map((st) => st.id)).toEqual(['s1']);
    expect(result[1]).toBe(other);
  });

  it('keeps an already orphaned task untouched', () => {
    const t = task('o', { projectId: '', tagIds: [] });
    expect(dropDeletedTagsFromArchivedTasks([t], existing)).toEqual([t]);
  });

  it('does not touch the input objects', () => {
    const t = task('t1', { tagIds: ['deleted', 'kept'] });
    dropDeletedTagsFromArchivedTasks([t], existing);
    expect(t.tagIds).toEqual(['deleted', 'kept']);
  });

  it('passes malformed entries through for sanitizeTasksForArchiving', () => {
    const malformed = undefined as unknown as TaskWithSubTasks;
    expect(dropDeletedTagsFromArchivedTasks([malformed], existing)).toEqual([malformed]);
  });
});
