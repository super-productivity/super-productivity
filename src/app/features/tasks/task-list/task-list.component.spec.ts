import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskListComponent } from './task-list.component';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { IssueService } from '../../issue/issue.service';
import { TaskViewCustomizerService } from '../../task-view-customizer/task-view-customizer.service';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TaskWithSubTasks } from '../task.model';
import { SectionService } from '../../section/section.service';
import { moveSubTask } from '../store/task.actions';
import { WorkContextType } from '../../work-context/work-context.model';

describe('TaskListComponent', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;
  let sectionServiceMock: jasmine.SpyObj<SectionService>;
  let store: MockStore;

  // Helper to create mock CdkDrag
  const createMockDrag = (task: { id: string; parentId: string | null }): CdkDrag =>
    ({
      data: task,
    }) as unknown as CdkDrag;

  // Helper to create mock CdkDropList with allTasks. listId defaults to
  // 'PARENT' to mirror top-level task lists; pass 'SUB' for subtask lists.
  const createMockDrop = (
    listModelId: string,
    allTasks: Partial<TaskWithSubTasks>[] = [],
    listId: 'PARENT' | 'SUB' = 'PARENT',
  ): CdkDropList =>
    ({
      data: { listId, listModelId, allTasks },
    }) as unknown as CdkDropList;

  beforeEach(async () => {
    sectionServiceMock = jasmine.createSpyObj<SectionService>('SectionService', [
      'addTaskToSection',
      'removeTaskFromSection',
    ]);

    await TestBed.configureTestingModule({
      imports: [TaskListComponent, NoopAnimationsModule],
      providers: [
        provideMockStore({ initialState: {} }),
        {
          provide: TaskService,
          useValue: { currentTaskId$: of(null) },
        },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextId: 'test-context',
            activeWorkContextType: 'TAG',
          },
        },
        { provide: IssueService, useValue: {} },
        { provide: TaskViewCustomizerService, useValue: { setSort: () => {} } },
        {
          provide: ScheduleExternalDragService,
          useValue: {
            setActiveTask: () => {},
            isCancelNextDrop: () => false,
            setCancelNextDrop: () => {},
          },
        },
        {
          provide: DropListService,
          useValue: {
            registerDropList: () => {},
            unregisterDropList: () => {},
            blockAniTrigger$: { next: () => {} },
          },
        },
        { provide: SectionService, useValue: sectionServiceMock },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch').and.callThrough();

    fixture = TestBed.createComponent(TaskListComponent);
    component = fixture.componentInstance;
    // Set required inputs
    fixture.componentRef.setInput('listId', 'PARENT');
    fixture.componentRef.setInput('listModelId', 'UNDONE');
    fixture.detectChanges();
  });

  describe('enterPredicate', () => {
    describe('subtasks appearing as top-level items (parent not in list)', () => {
      it('should allow subtask to reorder within UNDONE list when parent not present', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Parent NOT in allTasks - subtask appears as top-level
        const drop = createMockDrop('UNDONE', [{ id: 'sub1' }, { id: 'other-task' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move from UNDONE to DONE when parent not present', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('DONE', [{ id: 'done-task' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move from DONE to UNDONE when parent not present', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('UNDONE', [{ id: 'undone-task' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to reorder within DONE list when parent not present', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('DONE', [{ id: 'sub1' }, { id: 'other-done' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });
    });

    describe('nested subtasks (parent IS in target list)', () => {
      it('should block subtask from dropping to UNDONE when parent is in list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Parent IS in allTasks - subtask should stay nested
        const drop = createMockDrop('UNDONE', [{ id: 'parent1' }, { id: 'other-task' }]);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to DONE when parent is in list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('DONE', [{ id: 'parent1' }]);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should allow subtask to reorder within same parent subtask list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // listModelId is the parent task ID (subtask list)
        const drop = createMockDrop('parent1', [{ id: 'sub1' }, { id: 'sub2' }], 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move between different parent subtask lists', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Another task ID (not in PARENT_ALLOWED_LISTS)
        const drop = createMockDrop('parent2', [{ id: 'sub3' }], 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block subtask from dropping into a section drop-list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Section drop-lists render with listId='PARENT' and a section id.
        const drop = createMockDrop('section-abc', [], 'PARENT');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('parent tasks', () => {
      it('should allow parent task to move from UNDONE to DONE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('DONE', []);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task to reorder within UNDONE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('UNDONE', [{ id: 'task1' }, { id: 'task2' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task to move from DONE to UNDONE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('UNDONE', []);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task to move to BACKLOG', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('BACKLOG', []);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block parent task from dropping to subtask list', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        // Task ID listed as a subtask drop-list (listId='SUB').
        const drop = createMockDrop('some-task-id', [], 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should allow parent task to drop into a section drop-list', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        // Section drop-lists are listId='PARENT' with an arbitrary section id.
        const drop = createMockDrop('section-xyz', [], 'PARENT');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });
    });

    describe('blocked lists', () => {
      it('should block any task from dropping to OVERDUE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('OVERDUE', []);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to OVERDUE', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('OVERDUE', []);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block any task from dropping to LATER_TODAY', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('LATER_TODAY', []);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to LATER_TODAY', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('LATER_TODAY', []);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('ADD_TASK_PANEL interactions', () => {
      it('should allow parent task to drop into ADD_TASK_PANEL', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('ADD_TASK_PANEL', []);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block subtask from dropping to ADD_TASK_PANEL when parent is in list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('ADD_TASK_PANEL', [{ id: 'parent1' }]);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to ADD_TASK_PANEL even when parent not in list', () => {
        // ADD_TASK_PANEL is not DONE or UNDONE, so subtasks should be blocked
        // unless it's a subtask list (task ID)
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('ADD_TASK_PANEL', []);
        // ADD_TASK_PANEL is in PARENT_ALLOWED_LISTS but not a top-level list (DONE/UNDONE)
        // So subtasks are blocked unless target is not in PARENT_ALLOWED_LISTS
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('BACKLOG interactions', () => {
      it('should allow parent task to drop into BACKLOG', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('BACKLOG', []);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block subtask from dropping to BACKLOG when parent is in list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('BACKLOG', [{ id: 'parent1' }]);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to BACKLOG even when parent not in list', () => {
        // BACKLOG is in PARENT_ALLOWED_LISTS but not a top-level list (DONE/UNDONE)
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('BACKLOG', []);
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty allTasks array for subtask check', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Empty allTasks - parent definitely not in list
        const drop = createMockDrop('UNDONE', []);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should handle undefined allTasks for subtask check', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // allTasks is undefined (drop.data.allTasks || [] handles this)
        const drop = { data: { listModelId: 'UNDONE' } } as unknown as CdkDropList;
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should handle task with empty string parentId as parent task', () => {
        const task = { id: 'task1', parentId: '' as unknown as null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('UNDONE', []);
        // Empty string is falsy, so treated as parent task
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });
    });
  });

  // _move() routes drag drops to the correct dispatch path. The crux of the
  // section feature: a non-reserved listModelId must only be treated as a
  // section when listId === 'PARENT'; subtask drop-lists ('SUB') also use
  // non-reserved ids (parent task ids) and must fall through to moveSubTask.
  describe('_move dispatch routing', () => {
    // Cast to any to call the private method directly.
    const callMove = (
      taskId: string,
      src: string,
      target: string,
      srcListId: 'PARENT' | 'SUB',
      targetListId: 'PARENT' | 'SUB',
      newOrderedIds: string[] = [taskId],
    ): void => {
      (
        component as unknown as {
          _move: (
            t: string,
            s: string,
            tg: string,
            sl: 'PARENT' | 'SUB',
            tl: 'PARENT' | 'SUB',
            ids: string[],
          ) => void;
        }
      )._move(taskId, src, target, srcListId, targetListId, newOrderedIds);
    };

    it('routes a subtask drop into another subtask list to moveSubTask (not addTaskToSection)', () => {
      // Both src and target are subtask lists with parent task ids as listModelId.
      callMove('sub1', 'parentA', 'parentB', 'SUB', 'SUB');

      expect(sectionServiceMock.addTaskToSection).not.toHaveBeenCalled();
      const dispatchedAction = (store.dispatch as jasmine.Spy).calls.mostRecent()
        .args[0] as ReturnType<typeof moveSubTask>;
      expect(dispatchedAction.type).toBe(moveSubTask.type);
      expect(dispatchedAction.taskId).toBe('sub1');
      expect(dispatchedAction.srcTaskId).toBe('parentA');
      expect(dispatchedAction.targetTaskId).toBe('parentB');
    });

    it('routes a parent drop into a section drop-list (PARENT + non-reserved id) to addTaskToSection', () => {
      callMove('task1', 'UNDONE', 'section-abc', 'PARENT', 'PARENT');

      const args = sectionServiceMock.addTaskToSection.calls.mostRecent().args;
      expect(args[0]).toBe('section-abc');
      expect(args[1]).toBe('task1');
      // Source was a reserved list (UNDONE), so sourceSectionId is null.
      expect(args[3]).toBeNull();
    });

    it('passes the explicit sourceSectionId when dragging between sections', () => {
      callMove('task1', 'section-from', 'section-to', 'PARENT', 'PARENT');

      const args = sectionServiceMock.addTaskToSection.calls.mostRecent().args;
      expect(args[0]).toBe('section-to');
      expect(args[1]).toBe('task1');
      expect(args[3]).toBe('section-from');
    });

    it('computes afterTaskId from newOrderedIds (anchor: previous sibling)', () => {
      // newOrderedIds is the post-drop order of the destination list.
      // getAnchorFromDragDrop returns the id immediately preceding `taskId`,
      // which is what placeTaskAfterAnchor uses to position the move.
      callMove('task1', 'UNDONE', 'section-x', 'PARENT', 'PARENT', [
        'before',
        'task1',
        'after',
      ]);

      const args = sectionServiceMock.addTaskToSection.calls.mostRecent().args;
      expect(args[0]).toBe('section-x');
      expect(args[1]).toBe('task1');
      expect(args[2]).toBe('before');
      expect(args[3]).toBeNull();
    });

    it('passes null afterTaskId when dropped at the start of a section', () => {
      callMove('task1', 'UNDONE', 'section-x', 'PARENT', 'PARENT', ['task1', 'after']);

      const args = sectionServiceMock.addTaskToSection.calls.mostRecent().args;
      expect(args[2]).toBeNull();
    });

    it('routes a section -> no-section drag to removeTaskFromSection with workContext anchor', () => {
      callMove('task1', 'section-from', 'UNDONE', 'PARENT', 'PARENT', [
        'before-anchor',
        'task1',
      ]);

      expect(sectionServiceMock.removeTaskFromSection).toHaveBeenCalledWith(
        'section-from',
        'task1',
        'test-context',
        WorkContextType.TAG,
        'before-anchor',
      );
      expect(sectionServiceMock.addTaskToSection).not.toHaveBeenCalled();
    });

    it('does NOT route reserved-list drops (DONE/UNDONE/BACKLOG) as section moves', () => {
      callMove('task1', 'UNDONE', 'DONE', 'PARENT', 'PARENT');

      expect(sectionServiceMock.addTaskToSection).not.toHaveBeenCalled();
      expect(sectionServiceMock.removeTaskFromSection).not.toHaveBeenCalled();
    });
  });
});
