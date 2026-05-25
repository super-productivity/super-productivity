import { projectReducer } from './project.reducer';
import { fakeEntityStateFromArray } from '../../../util/fake-entity-state-from-array';
import { Project } from '../project.model';
import {
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToRegularList,
  updateProjectOrder,
} from './project.actions';
import { moveNoteToOtherProject } from '../../note/store/note.actions';
import { INBOX_PROJECT } from '../project.const';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';

describe('projectReducer', () => {
  describe('UpdateProjectOrder', () => {
    it('Should re-add archived projects if incomplete list is given as param', () => {
      const s = fakeEntityStateFromArray([
        { id: 'A', isArchived: false },
        { id: INBOX_PROJECT.id, isArchived: false },
        { id: 'B', isArchived: false },
        { id: 'C', isArchived: true },
      ] as Partial<Project>[]);

      const ids = ['B', 'A'];
      const r = projectReducer(s as any, updateProjectOrder({ ids }) as any);
      expect(r.ids).toEqual([INBOX_PROJECT.id, 'B', 'A', 'C']);
    });

    it('Should throw an error for inconsistent data', () => {
      const s = fakeEntityStateFromArray([
        { id: 'A', isArchived: false },
        { id: 'B', isArchived: false },
        { id: 'C', isArchived: false },
      ] as Partial<Project>[]);
      const ids = ['B', 'A'];
      expect(() => {
        projectReducer(s as any, updateProjectOrder({ ids }) as any);
      }).toThrowError('Invalid param given to UpdateProjectOrder');
    });

    it('Should work with correct params', () => {
      const s = fakeEntityStateFromArray([
        { id: 'A', isArchived: false },
        { id: 'B', isArchived: false },
        { id: 'C', isArchived: true },
      ] as Partial<Project>[]);
      const ids = ['B', 'A', 'C'];
      const r = projectReducer(s as any, updateProjectOrder({ ids }) as any);
      expect(r.ids).toEqual(['B', 'A', 'C']);
    });

    it('Should work with all unarchived projects', () => {
      const s = fakeEntityStateFromArray([
        { id: 'A', isArchived: false },
        { id: 'B', isArchived: false },
        { id: 'C', isArchived: false },
      ] as Partial<Project>[]);

      const ids = ['B', 'A', 'C'];
      const r = projectReducer(s as any, updateProjectOrder({ ids }) as any);
      expect(r.ids).toEqual(['B', 'A', 'C']);
    });

    it('Should allow sorting of archived ids as well', () => {
      const s = fakeEntityStateFromArray([
        { id: 'A', isArchived: false },
        { id: 'B', isArchived: false },
        { id: 'C', isArchived: true },
        { id: 'D', isArchived: true },
      ] as Partial<Project>[]);

      const ids = ['D', 'C'];
      const r = projectReducer(s as any, updateProjectOrder({ ids }) as any);
      expect(r.ids).toEqual(['A', 'B', 'D', 'C']);
    });
  });

  describe('moveNoteToOtherProject', () => {
    it('should update project note list accordingly', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', noteIds: ['A', 'B'] },
        { id: 'P2', noteIds: ['C'] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveNoteToOtherProject({
          note: {
            id: 'A',
            projectId: 'P1',
          } as any,
          targetProjectId: 'P2',
        }) as any,
      );
      expect((r.entities as any).P1.noteIds).toEqual(['B']);
      expect((r.entities as any).P2.noteIds).toEqual(['C', 'A']);
    });

    it('should update project note list correctly for no project notes', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', noteIds: ['A', 'B'] },
        { id: 'P2', noteIds: ['C'] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveNoteToOtherProject({
          note: {
            id: 'NEW',
            projectId: null,
          } as any,
          targetProjectId: 'P2',
        }) as any,
      );
      expect((r.entities as any).P1.noteIds).toEqual(['A', 'B']);
      expect((r.entities as any).P2.noteIds).toEqual(['C', 'NEW']);
    });
  });

  describe('moveProjectTaskInBacklogList (anchor-based)', () => {
    it('should move task to start of backlog when afterTaskId is null', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', backlogTaskIds: ['A', 'B', 'C'], taskIds: [], isEnableBacklog: true },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskInBacklogList({
          taskId: 'C',
          afterTaskId: null,
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['C', 'A', 'B']);
    });

    it('should move task after specified anchor in backlog', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', backlogTaskIds: ['A', 'B', 'C'], taskIds: [], isEnableBacklog: true },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskInBacklogList({
          taskId: 'C',
          afterTaskId: 'A',
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['A', 'C', 'B']);
    });

    it('should handle moving task to end of backlog', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', backlogTaskIds: ['A', 'B', 'C'], taskIds: [], isEnableBacklog: true },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskInBacklogList({
          taskId: 'A',
          afterTaskId: 'C',
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B', 'C', 'A']);
    });
  });

  describe('moveProjectTaskToBacklogList (anchor-based)', () => {
    it('should move task from today to start of backlog when afterTaskId is null', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToBacklogList({
          taskId: 'T1',
          afterTaskId: null,
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['T2']);
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['T1', 'B1', 'B2']);
    });

    it('should move task from today to specific position in backlog', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToBacklogList({
          taskId: 'T1',
          afterTaskId: 'B1',
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['T2']);
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B1', 'T1', 'B2']);
    });

    it('should move task to end of backlog when anchor is last item', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToBacklogList({
          taskId: 'T1',
          afterTaskId: 'B2',
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['T2']);
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B1', 'B2', 'T1']);
    });

    it('should not move if backlog is disabled', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: [],
          isEnableBacklog: false,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToBacklogList({
          taskId: 'T1',
          afterTaskId: null,
          workContextId: 'P1',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['T1', 'T2']);
      expect((r.entities as any).P1.backlogTaskIds).toEqual([]);
    });
  });

  describe('moveProjectTaskToRegularList (anchor-based)', () => {
    it('should move task from backlog to start of today list when afterTaskId is null', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToRegularList({
          taskId: 'B1',
          afterTaskId: null,
          workContextId: 'P1',
          src: 'BACKLOG',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B2']);
      expect((r.entities as any).P1.taskIds).toEqual(['B1', 'T1', 'T2']);
    });

    it('should move task from backlog to specific position in today list', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToRegularList({
          taskId: 'B1',
          afterTaskId: 'T1',
          workContextId: 'P1',
          src: 'BACKLOG',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B2']);
      expect((r.entities as any).P1.taskIds).toEqual(['T1', 'B1', 'T2']);
    });

    it('should move task to end of today list when anchor is last item', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToRegularList({
          taskId: 'B1',
          afterTaskId: 'T2',
          workContextId: 'P1',
          src: 'BACKLOG',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B2']);
      expect((r.entities as any).P1.taskIds).toEqual(['T1', 'T2', 'B1']);
    });

    it('should handle moving to empty today list', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: [],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToRegularList({
          taskId: 'B1',
          afterTaskId: null,
          workContextId: 'P1',
          src: 'BACKLOG',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B2']);
      expect((r.entities as any).P1.taskIds).toEqual(['B1']);
    });

    it('should append to end when moving to DONE section with null anchor', () => {
      const s = fakeEntityStateFromArray([
        {
          id: 'P1',
          taskIds: ['T1', 'T2'],
          backlogTaskIds: ['B1', 'B2'],
          isEnableBacklog: true,
        },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveProjectTaskToRegularList({
          taskId: 'B1',
          afterTaskId: null,
          workContextId: 'P1',
          src: 'BACKLOG',
          target: 'DONE',
        }) as any,
      );
      expect((r.entities as any).P1.backlogTaskIds).toEqual(['B2']);
      // When target is DONE and afterTaskId is null, append to end
      expect((r.entities as any).P1.taskIds).toEqual(['T1', 'T2', 'B1']);
    });
  });

  describe('moveTaskInTodayList (anchor-based)', () => {
    it('should move task to start when afterTaskId is null and target is UNDONE', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', taskIds: ['A', 'B', 'C'], backlogTaskIds: [] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveTaskInTodayList({
          taskId: 'C',
          afterTaskId: null,
          workContextType: WorkContextType.PROJECT,
          workContextId: 'P1',
          src: 'UNDONE',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['C', 'A', 'B']);
    });

    it('should move task after specified anchor', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', taskIds: ['A', 'B', 'C'], backlogTaskIds: [] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveTaskInTodayList({
          taskId: 'C',
          afterTaskId: 'A',
          workContextType: WorkContextType.PROJECT,
          workContextId: 'P1',
          src: 'UNDONE',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['A', 'C', 'B']);
    });

    it('should move task to end when anchor is last item', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', taskIds: ['A', 'B', 'C'], backlogTaskIds: [] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveTaskInTodayList({
          taskId: 'A',
          afterTaskId: 'C',
          workContextType: WorkContextType.PROJECT,
          workContextId: 'P1',
          src: 'UNDONE',
          target: 'UNDONE',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['B', 'C', 'A']);
    });

    it('should append to end when afterTaskId is null and target is DONE', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', taskIds: ['A', 'B', 'C'], backlogTaskIds: [] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveTaskInTodayList({
          taskId: 'A',
          afterTaskId: null,
          workContextType: WorkContextType.PROJECT,
          workContextId: 'P1',
          src: 'UNDONE',
          target: 'DONE',
        }) as any,
      );
      expect((r.entities as any).P1.taskIds).toEqual(['B', 'C', 'A']);
    });

    it('should not modify state when workContextType is TAG', () => {
      const s = fakeEntityStateFromArray([
        { id: 'P1', taskIds: ['A', 'B', 'C'], backlogTaskIds: [] },
      ] as Partial<Project>[]);

      const r = projectReducer(
        s as any,
        moveTaskInTodayList({
          taskId: 'C',
          afterTaskId: null,
          workContextType: WorkContextType.TAG,
          workContextId: 'some-tag',
          src: 'UNDONE',
          target: 'UNDONE',
        }) as any,
      );
      expect(r).toBe(s);
    });
  });
});
