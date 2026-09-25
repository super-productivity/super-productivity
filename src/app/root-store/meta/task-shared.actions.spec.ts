import { SUPER_SYNC_MAX_ENTITY_IDS_PER_OP } from '@sp/shared-schema';
import { collectArchivedTaskEntityIds, TaskSharedActions } from './task-shared.actions';
import { TaskWithSubTasks } from '../../features/tasks/task.model';

describe('TaskSharedActions.moveToArchive entityIds', () => {
  const createParent = (id: string, subTaskIds: string[]): TaskWithSubTasks =>
    ({
      id,
      title: `Task ${id}`,
      subTaskIds,
      subTasks: subTaskIds.map((subTaskId) => ({ id: subTaskId, parentId: id })),
    }) as unknown as TaskWithSubTasks;

  it('declares the subtasks the archive cascades to, parents first', () => {
    const action = TaskSharedActions.moveToArchive({
      tasks: [createParent('parent-1', ['sub-1', 'sub-2']), createParent('parent-2', [])],
    });

    expect(action.meta.entityIds).toEqual(['parent-1', 'parent-2', 'sub-1', 'sub-2']);
  });

  it('deduplicates ids carried by both subTaskIds and subTasks', () => {
    const ids = collectArchivedTaskEntityIds([
      { id: 'parent-1', subTaskIds: ['sub-1'], subTasks: [{ id: 'sub-1' }] },
    ]);

    expect(ids).toEqual(['parent-1', 'sub-1']);
  });

  it('drops non-string and empty ids — entityIds goes on the wire', () => {
    const ids = collectArchivedTaskEntityIds([
      { id: 'parent-1', subTaskIds: [null, 42, '', 'sub-1'], subTasks: [{}, null] },
      null,
      'not-a-task',
    ]);

    expect(ids).toEqual(['parent-1', 'sub-1']);
  });

  it('tolerates a task without subtask fields (old snapshots)', () => {
    expect(collectArchivedTaskEntityIds([{ id: 'parent-1' }])).toEqual(['parent-1']);
  });

  it('falls back to top-level ids when the cascade would exceed the server cap', () => {
    // A rejected upload (INVALID_ENTITY_ID) would strand the archive unsynced;
    // receivers re-derive the cascade from the payload, so this degrades safely.
    const tasks = Array.from({ length: SUPER_SYNC_MAX_ENTITY_IDS_PER_OP }, (_, i) => ({
      id: `parent-${i}`,
      subTaskIds: [`sub-${i}`],
    }));

    const ids = collectArchivedTaskEntityIds(tasks);

    expect(ids.length).toBe(SUPER_SYNC_MAX_ENTITY_IDS_PER_OP);
    expect(ids).not.toContain('sub-0');
  });
});
