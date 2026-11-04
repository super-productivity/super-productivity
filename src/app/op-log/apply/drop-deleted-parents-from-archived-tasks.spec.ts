import { dropDeletedParentsFromArchivedTasks } from './drop-deleted-parents-from-archived-tasks';
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

const subTask = (
  id: string,
  parentId: string,
  tagIds: string[],
  projectId = 'INBOX',
): Task => ({ id, parentId, projectId, tagIds, subTaskIds: [] }) as unknown as Task;

describe('dropDeletedParentsFromArchivedTasks', () => {
  const existing = {
    tagIds: new Set(['kept']),
    projectIds: new Set(['INBOX', 'project-kept']),
  };

  it('returns tasks untouched (same reference) when every tag still exists', () => {
    const t = task('t1', { tagIds: ['kept'] });
    const result = dropDeletedParentsFromArchivedTasks([t], existing);
    expect(result).toEqual([t]);
    expect(result[0]).toBe(t);
  });

  it('removes a tag id that no longer exists locally (#11466)', () => {
    const result = dropDeletedParentsFromArchivedTasks(
      [task('t1', { tagIds: ['deleted', 'kept'] })],
      existing,
    );
    expect(result.length).toBe(1);
    expect(result[0].tagIds).toEqual(['kept']);
  });

  it('keeps a task with a project when its only tag is gone', () => {
    const result = dropDeletedParentsFromArchivedTasks(
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
    const result = dropDeletedParentsFromArchivedTasks([parent], existing);
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
    const result = dropDeletedParentsFromArchivedTasks([orphan, other], existing);
    expect(result.map((t) => t.id)).toEqual(['o', 't2']);
    expect(result[0].tagIds).toEqual([]);
    expect(result[0].subTasks.map((st) => st.id)).toEqual(['s1']);
    expect(result[1]).toBe(other);
  });

  it('keeps an already orphaned task untouched', () => {
    const t = task('o', { projectId: '', tagIds: [] });
    expect(dropDeletedParentsFromArchivedTasks([t], existing)).toEqual([t]);
  });

  it('does not touch the input objects', () => {
    const t = task('t1', { tagIds: ['deleted', 'kept'] });
    dropDeletedParentsFromArchivedTasks([t], existing);
    expect(t.tagIds).toEqual(['deleted', 'kept']);
  });

  it('passes malformed entries through for sanitizeTasksForArchiving', () => {
    const malformed = undefined as unknown as TaskWithSubTasks;
    expect(dropDeletedParentsFromArchivedTasks([malformed], existing)).toEqual([
      malformed,
    ]);
  });

  describe('deleted projects (#11486)', () => {
    it('drops a root task whose project no longer exists, with its subtasks', () => {
      const gone = task('g', {
        projectId: 'project-deleted',
        subTaskIds: ['s1'],
        subTasks: [subTask('s1', 'g', [], 'project-deleted')],
      });
      const kept = task('k', { projectId: 'project-kept' });
      const result = dropDeletedParentsFromArchivedTasks([gone, kept], existing);
      expect(result).toEqual([kept]);
      expect(result[0]).toBe(kept);
    });

    it('keeps tasks of INBOX and of existing projects untouched', () => {
      const inbox = task('i', { projectId: 'INBOX' });
      const other = task('o', { projectId: 'project-kept' });
      const result = dropDeletedParentsFromArchivedTasks([inbox, other], existing);
      expect(result[0]).toBe(inbox);
      expect(result[1]).toBe(other);
    });

    it('keeps a task without a project (tag-only)', () => {
      const tagOnly = task('t', { projectId: '', tagIds: ['kept'] });
      expect(dropDeletedParentsFromArchivedTasks([tagOnly], existing)).toEqual([tagOnly]);
    });

    it('drops a subtask whose own project no longer exists and its id', () => {
      const parent = task('p', {
        projectId: 'project-kept',
        subTaskIds: ['s1', 's2'],
        subTasks: [
          subTask('s1', 'p', [], 'project-deleted'),
          subTask('s2', 'p', [], 'project-kept'),
        ],
      });
      const result = dropDeletedParentsFromArchivedTasks([parent], existing);
      expect(result[0].subTasks.map((st) => st.id)).toEqual(['s2']);
      expect(result[0].subTaskIds).toEqual(['s2']);
      expect(parent.subTaskIds).toEqual(['s1', 's2']);
    });

    it('drops a task whose project is gone even when its tags still exist', () => {
      const t = task('t', { projectId: 'project-deleted', tagIds: ['kept'] });
      expect(dropDeletedParentsFromArchivedTasks([t], existing)).toEqual([]);
    });
  });
});
