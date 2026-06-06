import { INBOX_PROJECT } from '../../features/project/project.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { TaskSharedActions } from './task-shared.actions';

describe('TaskSharedActions', () => {
  describe('completeProject', () => {
    it('declares every entity touched by project completion resolution', () => {
      const action = TaskSharedActions.completeProject({
        id: 'project-1',
        doneOn: 1_800_000_000_000,
        taskIdsToMarkDone: ['task-1', 'task-2'],
        topLevelTaskIdsToMoveToInbox: ['task-2'],
        taskIdsToMoveToInbox: ['task-2', 'sub-task-1'],
        taskIdsToMarkUndone: ['task-2'],
      });

      expect(action.meta.affectedEntities).toEqual([
        { entityType: 'PROJECT', entityId: 'project-1' },
        { entityType: 'PROJECT', entityId: INBOX_PROJECT.id },
        { entityType: 'TASK', entityId: 'task-1' },
        { entityType: 'TASK', entityId: 'task-2' },
        { entityType: 'TASK', entityId: 'sub-task-1' },
        { entityType: 'TAG', entityId: TODAY_TAG.id },
      ]);
    });

    it('marks Inbox affected when only full moved task ids are provided', () => {
      const action = TaskSharedActions.completeProject({
        id: 'project-1',
        doneOn: 1_800_000_000_000,
        taskIdsToMoveToInbox: ['task-1', 'sub-task-1'],
      });

      expect(action.meta.affectedEntities).toContain({
        entityType: 'PROJECT',
        entityId: INBOX_PROJECT.id,
      });
    });
  });
});
