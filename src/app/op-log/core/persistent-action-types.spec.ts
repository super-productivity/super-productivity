/**
 * Tests for persistent action type stability.
 *
 * IMPORTANT: When renaming a persistent action type:
 * 1. Add an entry to ACTION_TYPE_ALIASES in operation-converter.util.ts
 *    mapping the old name to the new name
 * 2. Update any affected tests
 *
 * The alias registry ensures old operations can still be replayed after renames.
 */

import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { syncTimeSpent } from '../../features/time-tracking/store/time-tracking.actions';
import { flushYoungToOld } from '../../features/archive/store/archive.actions';
import {
  addProject,
  updateProject,
  archiveProject,
} from '../../features/project/store/project.actions';
import { addTag, updateTag, deleteTag } from '../../features/tag/store/tag.actions';
import { addNote, updateNote, deleteNote } from '../../features/note/store/note.actions';
import { updateGlobalConfigSection } from '../../features/config/store/global-config.actions';

describe('Persistent Action Types Stability', () => {
  /**
   * These are the core persistent action types that MUST NOT change.
   * If a rename is necessary, add an alias in ACTION_TYPE_ALIASES first!
   */
  describe('Core action types should remain stable', () => {
    it('TaskSharedActions should have stable types', () => {
      expect(TaskSharedActions.addTask.type).toBe('[Task Shared] addTask');
      expect(TaskSharedActions.updateTask.type).toBe('[Task Shared] updateTask');
      expect(TaskSharedActions.deleteTask.type).toBe('[Task Shared] deleteTask');
      expect(TaskSharedActions.moveToArchive.type).toBe('[Task Shared] moveToArchive');
      expect(TaskSharedActions.restoreTask.type).toBe('[Task Shared] restoreTask');
      expect(TaskSharedActions.planTasksForToday.type).toBe(
        '[Task Shared] planTasksForToday',
      );
    });

    it('Project actions should have stable types', () => {
      expect(addProject.type).toBe('[Project] Add Project');
      expect(updateProject.type).toBe('[Project] Update Project');
      expect(archiveProject.type).toBe('[Project] Archive Project');
    });

    it('Tag actions should have stable types', () => {
      expect(addTag.type).toBe('[Tag] Add Tag');
      expect(updateTag.type).toBe('[Tag] Update Tag');
      expect(deleteTag.type).toBe('[Tag] Delete Tag');
    });

    it('Note actions should have stable types', () => {
      expect(addNote.type).toBe('[Note] Add Note');
      expect(updateNote.type).toBe('[Note] Update Note');
      expect(deleteNote.type).toBe('[Note] Delete Note');
    });

    it('Global config action should have stable type', () => {
      expect(updateGlobalConfigSection.type).toBe(
        '[Global Config] Update Global Config Section',
      );
    });

    it('Time tracking sync action should have stable type', () => {
      expect(syncTimeSpent.type).toBe('[TimeTracking] Sync time spent');
    });

    it('Archive flush action should have stable type', () => {
      expect(flushYoungToOld.type).toBe('[Archive] Flush Young to Old');
    });
  });

  /**
   * Document the procedure for safely renaming actions.
   */
  describe('Action rename safety documentation', () => {
    it('should document the safe rename procedure', () => {
      // This test serves as documentation.
      // When you need to rename a persistent action:
      //
      // 1. BEFORE renaming, add an alias in operation-converter.util.ts:
      //    ACTION_TYPE_ALIASES['[Old] Action Name'] = '[New] Action Name';
      //
      // 2. Then rename the action in the action file
      //
      // 3. Update any tests that reference the action type
      //
      // 4. NEVER remove entries from ACTION_TYPE_ALIASES -
      //    old operations may still reference the old name
      //
      // The alias ensures that when replaying old operations from the log,
      // they get mapped to the current action name.
      expect(true).toBe(true);
    });
  });
});
