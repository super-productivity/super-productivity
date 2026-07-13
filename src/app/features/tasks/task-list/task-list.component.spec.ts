import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskListComponent } from './task-list.component';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { IssueService } from '../../issue/issue.service';
import { TaskViewCustomizerService } from '../../task-view-customizer/task-view-customizer.service';
import { NO_TAG_GROUP_ID } from '../../task-view-customizer/types';
import { ScheduleExternalDragService } from '../../schedule/schedule-week/schedule-external-drag.service';
import { DropListService } from '../../../core-ui/drop-list/drop-list.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TaskWithSubTasks } from '../task.model';
import { SectionService } from '../../section/section.service';
import { moveSubTask } from '../store/task.actions';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../../work-context/work-context.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Task } from '../task.model';

describe('TaskListComponent', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;
  let sectionServiceMock: jasmine.SpyObj<SectionService>;
  let dropListServiceMock: {
    registerDropList: jasmine.Spy;
    unregisterDropList: jasmine.Spy;
    activeDragPointer: jasmine.Spy;
    setActiveDragPointer: jasmine.Spy;
    isSubTaskDragStarting: jasmine.Spy;
    markSubTaskDragStarting: jasmine.Spy;
    hitTestPointerSubTaskList: jasmine.Spy;
    blockAniTrigger$: { next: jasmine.Spy };
  };
  let store: MockStore;

  type MockDragTask = Omit<Partial<Task>, 'parentId'> & {
    id: string;
    parentId?: string | null;
  };

  // Helper to create mock CdkDrag
  const createMockDrag = (task: MockDragTask): CdkDrag =>
    ({
      data: task,
    }) as unknown as CdkDrag;

  // Helper to create mock CdkDropList. listId defaults to 'PARENT' to
  // mirror top-level task lists; pass 'SUB' for subtask lists.
  const createMockDrop = (
    listModelId: string,
    listId: 'PARENT' | 'SUB' = 'PARENT',
  ): CdkDropList =>
    ({
      data: { listId, listModelId, filteredTasks: [] },
    }) as unknown as CdkDropList;

  beforeEach(async () => {
    sectionServiceMock = jasmine.createSpyObj<SectionService>('SectionService', [
      'addTaskToSection',
      'removeTaskFromSection',
    ]);
    dropListServiceMock = {
      registerDropList: jasmine.createSpy('registerDropList'),
      unregisterDropList: jasmine.createSpy('unregisterDropList'),
      activeDragPointer: jasmine.createSpy('activeDragPointer').and.returnValue(null),
      setActiveDragPointer: jasmine.createSpy('setActiveDragPointer'),
      isSubTaskDragStarting: jasmine
        .createSpy('isSubTaskDragStarting')
        .and.returnValue(false),
      markSubTaskDragStarting: jasmine.createSpy('markSubTaskDragStarting'),
      // Pass-through: tests exercise the real _computePointerSubTaskList; the
      // per-pointer memo only matters at runtime (not under mocked hit-tests).
      hitTestPointerSubTaskList: jasmine
        .createSpy('hitTestPointerSubTaskList')
        .and.callFake((_x: number, _y: number, compute: () => unknown) => compute()),
      blockAniTrigger$: { next: jasmine.createSpy('next') },
    };

    await TestBed.configureTestingModule({
      imports: [TaskListComponent, NoopAnimationsModule],
      providers: [
        provideMockStore({ initialState: {} }),
        {
          provide: TaskService,
          useValue: {
            currentTaskId$: of(null),
            updateTags: jasmine.createSpy('updateTags'),
            addToToday: jasmine.createSpy('addToToday'),
          },
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
            activeTask: () => null,
            setActiveTask: () => {},
            isCancelNextDrop: () => false,
            setCancelNextDrop: () => {},
          },
        },
        {
          provide: DropListService,
          useValue: dropListServiceMock,
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
    describe('subtasks in parent-level DONE/UNDONE lists', () => {
      it('should allow subtask to reorder within UNDONE', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('UNDONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move from UNDONE to DONE', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('DONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move from DONE to UNDONE', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('UNDONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to reorder within DONE', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('DONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });
    });

    describe('subtasks dragged from nested lists', () => {
      it('should allow subtask to drop to UNDONE so it can become a main task', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('UNDONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to drop to DONE so it can become a completed main task', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('DONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      // Mounts a detached `.task-list-inner[data-list-id=SUB]` and points
      // `elementFromPoint` at either a real subtask row or the list's empty
      // padding, so enterPredicate exercises the live pointer hit-test.
      const withPointerOverSubList = (
        opts: { listModelId: string; overRow: boolean; enclosingParentTask?: boolean },
        run: () => void,
      ): void => {
        const hit = opts.overRow ? '<task id="hit"></task>' : '<div id="hit"></div>';
        const subList = `<div class="task-list-inner" data-list-id="SUB" data-id="${opts.listModelId}">${hit}</div>`;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = opts.enclosingParentTask
          ? `<div class="task-list-inner" data-list-id="PARENT" data-id="UNDONE"><task>${subList}</task></div>`
          : subList;
        document.body.appendChild(wrapper);
        const hitEl = wrapper.querySelector('#hit') as Element;
        spyOn(document, 'elementFromPoint').and.returnValue(hitEl);
        dropListServiceMock.activeDragPointer.and.returnValue({ x: 10, y: 20 });
        try {
          run();
        } finally {
          wrapper.remove();
        }
      };

      // Mounts a parent <task> with a `.sub-tasks` wrapper around the SUB
      // list, and points `elementFromPoint` at the wrapper itself — i.e.,
      // inside the leading strip that lives BETWEEN the parent header and
      // the first subtask row. That strip is the `.sub-tasks` margin plus
      // the inner `task-list` host padding (see task-list.component.scss /
      // _task-base.scss), outside `.task-list-inner`'s clientRect.
      const withPointerOverSubListWrapper = (
        opts: { listModelId: string; sourceModelId?: string },
        run: () => void,
      ): void => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
          <div class="task-list-inner" data-list-id="PARENT" data-id="UNDONE">
            <task>
              <div class="sub-tasks">
                <div id="hit"></div>
                <div class="task-list-inner" data-list-id="SUB" data-id="${opts.listModelId}">
                  <task></task>
                </div>
              </div>
            </task>
          </div>
        `;
        document.body.appendChild(wrapper);
        const hitEl = wrapper.querySelector('#hit') as Element;
        spyOn(document, 'elementFromPoint').and.returnValue(hitEl);
        dropListServiceMock.activeDragPointer.and.returnValue({ x: 10, y: 20 });
        try {
          run();
        } finally {
          wrapper.remove();
        }
      };

      const subtaskDragFrom = (sourceModelId: string): CdkDrag => {
        const drag = createMockDrag({ id: 'sub1', parentId: 'parent1' });
        Object.assign(drag, {
          dropContainer: { data: { listId: 'SUB', listModelId: sourceModelId } },
        });
        return drag;
      };

      it('should block the top-level list while the pointer is over the SOURCE subtask list (even its padding) so in-list sorting keeps working', () => {
        withPointerOverSubList({ listModelId: 'parent1', overRow: false }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('UNDONE');
          expect(component.enterPredicate(drag, drop)).toBe(false);
        });
      });

      it('should block the top-level list while the pointer is over a foreign subtask ROW (re-parent intent)', () => {
        withPointerOverSubList({ listModelId: 'parent2', overRow: true }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('UNDONE');
          expect(component.enterPredicate(drag, drop)).toBe(false);
        });
      });

      it('should accept the top-level list over a foreign subtask list trailing padding — the dead-band above the next parent (regression: #7905)', () => {
        withPointerOverSubList({ listModelId: 'parent2', overRow: false }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('UNDONE');
          expect(component.enterPredicate(drag, drop)).toBe(true);
        });
      });

      it('should not mistake the enclosing parent task for a row when over a foreign subtask list padding', () => {
        withPointerOverSubList(
          { listModelId: 'parent2', overRow: false, enclosingParentTask: true },
          () => {
            const drag = subtaskDragFrom('parent1');
            const drop = createMockDrop('UNDONE');
            expect(component.enterPredicate(drag, drop)).toBe(true);
          },
        );
      });

      it('should reject a foreign subtask list as drop target over its trailing padding (so the drag converts instead of re-parenting)', () => {
        withPointerOverSubList({ listModelId: 'parent2', overRow: false }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('parent2', 'SUB');
          expect(component.enterPredicate(drag, drop)).toBe(false);
        });
      });

      it('should accept a foreign subtask list as drop target over one of its rows (re-parent)', () => {
        withPointerOverSubList({ listModelId: 'parent2', overRow: true }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('parent2', 'SUB');
          expect(component.enterPredicate(drag, drop)).toBe(true);
        });
      });

      it('should accept a foreign subtask list when the pointer is in the LEADING `.sub-tasks` wrapper strip (drop as first child instead of converting at parent slot)', () => {
        // The strip between the parent header and the first subtask sits
        // OUTSIDE `.task-list-inner` but inside `.sub-tasks`. Without the
        // wrapper fallback, hit-test falls through to the top-level list
        // and the drag converts to a main task at the parent's slot.
        withPointerOverSubListWrapper({ listModelId: 'parent2' }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('parent2', 'SUB');
          expect(component.enterPredicate(drag, drop)).toBe(true);
        });
      });

      it('should block the top-level list when the pointer is in a foreign sublist LEADING wrapper strip (let the foreign SUB claim it for re-parent)', () => {
        withPointerOverSubListWrapper({ listModelId: 'parent2' }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('UNDONE', 'PARENT');
          expect(component.enterPredicate(drag, drop)).toBe(false);
        });
      });

      it('should block the top-level list when the pointer is in the SOURCE sublist leading wrapper strip (keep in-list sorting)', () => {
        withPointerOverSubListWrapper({ listModelId: 'parent1' }, () => {
          const drag = subtaskDragFrom('parent1');
          const drop = createMockDrop('UNDONE', 'PARENT');
          expect(component.enterPredicate(drag, drop)).toBe(false);
        });
      });

      it('should accept the enclosing parent list during the drag-start window even while the pointer is over a subtask list', () => {
        // At drag start the pointer is always over the source subtask list, so
        // the pointer guard alone would keep CDK from ever caching the parent
        // list geometry, leaving subtask -> main-task conversion broken until an
        // unrelated parent drag warmed the cache (regression: #7905).
        const wrapper = document.createElement('div');
        wrapper.innerHTML =
          '<div class="task-list-inner" data-list-id="SUB"><div id="hit"></div></div>';
        document.body.appendChild(wrapper);
        const hitEl = wrapper.querySelector('#hit') as Element;
        spyOn(document, 'elementFromPoint').and.returnValue(hitEl);
        dropListServiceMock.activeDragPointer.and.returnValue({ x: 10, y: 20 });
        dropListServiceMock.isSubTaskDragStarting.and.returnValue(true);
        const drag = createMockDrag({ id: 'sub1', parentId: 'parent1' });
        Object.assign(drag, {
          dropContainer: { data: { listId: 'SUB', listModelId: 'parent1' } },
        });
        const drop = createMockDrop('UNDONE');

        try {
          expect(component.enterPredicate(drag, drop)).toBe(true);
        } finally {
          wrapper.remove();
        }
      });

      it('should allow subtask to reorder within same parent subtask list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // listModelId is the parent task ID (subtask list)
        const drop = createMockDrop('parent1', 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move between different parent subtask lists', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Another task ID (not in PARENT_ALLOWED_LISTS)
        const drop = createMockDrop('parent2', 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block subtask from dropping into a section drop-list', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Section drop-lists render with listId='PARENT' and a section id.
        const drop = createMockDrop('section-abc');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('parent tasks', () => {
      it('should allow parent task to move from UNDONE to DONE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('DONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task to reorder within UNDONE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('UNDONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task to move from DONE to UNDONE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('UNDONE');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task to move to BACKLOG', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('BACKLOG');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow parent task without subtasks to drop to subtask list', () => {
        const task = { id: 'task1', parentId: null, subTaskIds: [] };
        const drag = createMockDrag(task);
        // Task ID listed as a subtask drop-list (listId='SUB').
        const drop = createMockDrop('some-task-id', 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block parent task with subtasks from dropping to subtask list', () => {
        const task = { id: 'task1', parentId: null, subTaskIds: ['sub1'] };
        const drag = createMockDrag(task);
        const drop = createMockDrop('some-task-id', 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should allow parent task with a plain due day to drop to subtask list', () => {
        const task = {
          id: 'task1',
          parentId: null,
          subTaskIds: [],
          dueDay: '2099-12-25',
        };
        const drag = createMockDrag(task);
        const drop = createMockDrop('some-task-id', 'SUB');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block timed, repeating, and issue-linked parent tasks from dropping to subtask list', () => {
        const drop = createMockDrop('some-task-id', 'SUB');

        expect(
          component.enterPredicate(
            createMockDrag({
              id: 'timed-task',
              parentId: null,
              subTaskIds: [],
              dueWithTime: 4070908800000,
            }),
            drop,
          ),
        ).toBe(false);

        expect(
          component.enterPredicate(
            createMockDrag({
              id: 'repeat-task',
              parentId: null,
              subTaskIds: [],
              repeatCfgId: 'repeat1',
            }),
            drop,
          ),
        ).toBe(false);

        expect(
          component.enterPredicate(
            createMockDrag({
              id: 'issue-task',
              parentId: null,
              subTaskIds: [],
              issueId: 'ISSUE-1',
            }),
            drop,
          ),
        ).toBe(false);
      });

      it('should allow parent task to drop into a section drop-list', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        // Section drop-lists are listId='PARENT' with an arbitrary section id.
        const drop = createMockDrop('section-xyz');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });
    });

    describe('blocked lists', () => {
      it('should block any task from dropping to OVERDUE', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('OVERDUE');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to OVERDUE', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('OVERDUE');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block any task from dropping to LATER_TODAY', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('LATER_TODAY');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });

      it('should block subtask from dropping to LATER_TODAY', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('LATER_TODAY');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('ADD_TASK_PANEL interactions', () => {
      it('should allow parent task to drop into ADD_TASK_PANEL', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('ADD_TASK_PANEL');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block subtask from dropping to ADD_TASK_PANEL', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('ADD_TASK_PANEL');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('BACKLOG interactions', () => {
      it('should allow parent task to drop into BACKLOG', () => {
        const task = { id: 'task1', parentId: null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('BACKLOG');
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should block subtask from dropping to BACKLOG', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = createMockDrop('BACKLOG');
        expect(component.enterPredicate(drag, drop)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should not require filtered task data for subtask top-level drops', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        const drop = { data: { listModelId: 'UNDONE' } } as unknown as CdkDropList;
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should handle task with empty string parentId as parent task', () => {
        const task = { id: 'task1', parentId: '' as unknown as null };
        const drag = createMockDrag(task);
        const drop = createMockDrop('UNDONE');
        // Empty string is falsy, so treated as parent task
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });
    });
  });

  describe('onDragStarted', () => {
    const createStartEvent = (): { source: { _dragRef: unknown } } => ({
      source: { _dragRef: {} },
    });

    afterEach(() => {
      // Tear down the window pointermove listener registered for subtask drags.
      component.onDragEnded();
    });

    it('opens the drag-start window for a subtask drag', () => {
      component.onDragStarted(
        { id: 'sub1', parentId: 'parent1' } as TaskWithSubTasks,
        createStartEvent() as never,
      );
      expect(dropListServiceMock.markSubTaskDragStarting).toHaveBeenCalledTimes(1);
    });

    it('does NOT open the drag-start window for a top-level task drag', () => {
      component.onDragStarted(
        { id: 'top1' } as TaskWithSubTasks,
        createStartEvent() as never,
      );
      expect(dropListServiceMock.markSubTaskDragStarting).not.toHaveBeenCalled();
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
            draggedTask?: TaskWithSubTasks,
          ) => void;
        }
      )._move(taskId, src, target, srcListId, targetListId, newOrderedIds, {
        id: taskId,
        parentId: srcListId === 'SUB' ? src : undefined,
      } as TaskWithSubTasks);
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

    it('routes a parent drop into a subtask list to convertToSubTask', () => {
      callMove('task1', 'UNDONE', 'parentB', 'PARENT', 'SUB', ['before', 'task1']);

      expect(sectionServiceMock.addTaskToSection).not.toHaveBeenCalled();
      const dispatchedAction = (store.dispatch as jasmine.Spy).calls.mostRecent()
        .args[0] as ReturnType<typeof TaskSharedActions.convertToSubTask>;
      expect(dispatchedAction.type).toBe(TaskSharedActions.convertToSubTask.type);
      expect(dispatchedAction.taskId).toBe('task1');
      expect(dispatchedAction.targetParentId).toBe('parentB');
      expect(dispatchedAction.afterTaskId).toBe('before');
    });

    it('routes a subtask drop into a parent list to convertToMainTask', () => {
      callMove('sub1', 'parentA', 'UNDONE', 'SUB', 'PARENT', ['before', 'sub1']);

      expect(sectionServiceMock.addTaskToSection).not.toHaveBeenCalled();
      const dispatchedAction = (store.dispatch as jasmine.Spy).calls.mostRecent()
        .args[0] as ReturnType<typeof TaskSharedActions.convertToMainTask>;
      expect(dispatchedAction.type).toBe(TaskSharedActions.convertToMainTask.type);
      expect(dispatchedAction.task.id).toBe('sub1');
      expect(dispatchedAction.task.parentId).toBe('parentA');
      expect(dispatchedAction.afterTaskId).toBe('before');
      expect(dispatchedAction.isDone).toBe(false);
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

    it('skips a reorder WITHIN the Done list (auto-sorted) so no moveTaskInTodayList op is emitted', () => {
      callMove('task1', 'DONE', 'DONE', 'PARENT', 'PARENT');

      const dispatched = (store.dispatch as jasmine.Spy).calls
        .allArgs()
        .map((args) => args[0]);
      expect(dispatched.some((a) => a.type === moveTaskInTodayList.type)).toBe(false);
    });

    it('still moves a task OUT of Done (DONE -> UNDONE) via moveTaskInTodayList', () => {
      callMove('task1', 'DONE', 'UNDONE', 'PARENT', 'PARENT');

      const dispatched = (store.dispatch as jasmine.Spy).calls
        .allArgs()
        .map((args) => args[0]);
      expect(dispatched.some((a) => a.type === moveTaskInTodayList.type)).toBe(true);
    });
  });

  // The public drop() handler turns a CdkDragDrop event into the right action,
  // including the placement math (newIds order -> anchor). Covers the
  // event->action translation the reducer specs assume.
  describe('drop() conversion dispatch', () => {
    type ListData = {
      listId: 'PARENT' | 'SUB';
      listModelId: string;
      filteredTasks: { id: string }[];
    };
    const dropEvent = (opts: {
      previous: ListData;
      target: ListData;
      dragged: MockDragTask;
      currentIndex: number;
    }): Parameters<TaskListComponent['drop']>[0] =>
      ({
        previousContainer: { data: opts.previous },
        container: { data: opts.target },
        item: { data: opts.dragged },
        previousIndex: 0,
        currentIndex: opts.currentIndex,
      }) as unknown as Parameters<TaskListComponent['drop']>[0];

    it('dispatches convertToSubTask when a top-level task is dropped into a subtask list', async () => {
      await component.drop(
        dropEvent({
          previous: {
            listId: 'PARENT',
            listModelId: 'UNDONE',
            filteredTasks: [{ id: 't1' }],
          },
          target: {
            listId: 'SUB',
            listModelId: 'p1',
            filteredTasks: [{ id: 's1' }, { id: 's2' }],
          },
          dragged: { id: 't1', parentId: null },
          currentIndex: 1, // onto s2 -> lands before s2 (after s1)
        }),
      );

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.convertToSubTask({
          taskId: 't1',
          targetParentId: 'p1',
          afterTaskId: 's1',
        }),
      );
    });

    it('passes afterTaskId null when dropped at the first subtask slot', async () => {
      await component.drop(
        dropEvent({
          previous: {
            listId: 'PARENT',
            listModelId: 'UNDONE',
            filteredTasks: [{ id: 't1' }],
          },
          target: {
            listId: 'SUB',
            listModelId: 'p1',
            filteredTasks: [{ id: 's1' }, { id: 's2' }],
          },
          dragged: { id: 't1', parentId: null },
          currentIndex: 0, // onto s1 -> lands before s1 (first child)
        }),
      );

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.convertToSubTask({
          taskId: 't1',
          targetParentId: 'p1',
          afterTaskId: null,
        }),
      );
    });

    it('dispatches convertToMainTask when a subtask is dropped into the top-level list', async () => {
      const dragged: MockDragTask = { id: 's1', parentId: 'p1' };
      await component.drop(
        dropEvent({
          previous: {
            listId: 'SUB',
            listModelId: 'p1',
            filteredTasks: [{ id: 's1' }, { id: 's2' }],
          },
          target: {
            listId: 'PARENT',
            listModelId: 'UNDONE',
            filteredTasks: [{ id: 't1' }, { id: 't2' }],
          },
          dragged,
          currentIndex: 1, // onto t2 -> lands before t2 (after t1)
        }),
      );

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.convertToMainTask.type,
          task: dragged as unknown as TaskWithSubTasks,
          isPlanForToday: false,
          afterTaskId: 't1',
          isDone: false,
          today: jasmine.any(String),
          modified: jasmine.any(Number),
        }),
      );
    });

    it('marks the converted task done when dropped into the DONE list', async () => {
      const dragged: MockDragTask = { id: 's1', parentId: 'p1' };
      await component.drop(
        dropEvent({
          previous: { listId: 'SUB', listModelId: 'p1', filteredTasks: [{ id: 's1' }] },
          target: { listId: 'PARENT', listModelId: 'DONE', filteredTasks: [] },
          dragged,
          currentIndex: 0,
        }),
      );

      expect(store.dispatch).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.convertToMainTask.type,
          task: dragged as unknown as TaskWithSubTasks,
          isPlanForToday: false,
          afterTaskId: null,
          isDone: true,
          today: jasmine.any(String),
          doneOn: jasmine.any(Number),
          modified: jasmine.any(Number),
        }),
      );
    });
  });

  // Grouped-by-tag view: a task dragged into a DIFFERENT tag group has its tags
  // reassigned (move: drop the source group's tag, add the target's) instead of
  // being reordered. groupTagId is undefined outside that view, null for a
  // no-single-tag bucket ('No tag' / 'Unknown tag' / duplicate-titled).
  describe('drop() tag-group retag', () => {
    type GroupListData = {
      listId: 'PARENT' | 'SUB';
      listModelId: string;
      filteredTasks: { id: string }[];
      groupTagId?: string | null;
    };
    const dropEvent = (opts: {
      previous: GroupListData;
      target: GroupListData;
      dragged: MockDragTask;
      currentIndex?: number;
    }): Parameters<TaskListComponent['drop']>[0] =>
      ({
        previousContainer: { data: opts.previous },
        container: { data: opts.target },
        item: { data: opts.dragged },
        previousIndex: 0,
        currentIndex: opts.currentIndex ?? 0,
      }) as unknown as Parameters<TaskListComponent['drop']>[0];

    const undoneGroup = (
      groupTagId: string | null | undefined,
      filteredTasks: { id: string }[] = [],
    ): GroupListData => ({
      listId: 'PARENT',
      listModelId: 'UNDONE',
      filteredTasks,
      groupTagId,
    });

    let taskService: { updateTags: jasmine.Spy };

    beforeEach(() => {
      taskService = TestBed.inject(TaskService) as unknown as typeof taskService;
      (store.dispatch as jasmine.Spy).calls.reset();
    });

    // The reorder fall-through (no retag) dispatches a moveTaskInTodayList.
    const expectReorderDispatched = (): void => {
      const dispatched = (store.dispatch as jasmine.Spy).calls
        .allArgs()
        .map((args) => args[0]);
      expect(dispatched.some((a) => a.type === moveTaskInTodayList.type)).toBe(true);
    };

    it('drops the source tag and adds the target tag, preserving other tags', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup('tagA'),
          target: undoneGroup('tagB', [{ id: 'keep' }]),
          dragged: { id: 't1', parentId: null, tagIds: ['tagA', 'tagC'] },
        }),
      );

      expect(taskService.updateTags).toHaveBeenCalledTimes(1);
      const [task, newTags] = taskService.updateTags.calls.mostRecent().args;
      expect(task.id).toBe('t1');
      expect(newTags).toEqual(['tagC', 'tagB']);
      // Retag short-circuits the reorder path.
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('adds the target tag when dragging out of the "No tag" bucket (no removal)', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup(NO_TAG_GROUP_ID),
          target: undoneGroup('tagB'),
          dragged: { id: 't1', parentId: null, tagIds: [] },
        }),
      );

      expect(taskService.updateTags).toHaveBeenCalledTimes(1);
      const [, newTags] = taskService.updateTags.calls.mostRecent().args;
      expect(newTags).toEqual(['tagB']);
    });

    it('clears all tags when dropping onto the "No tag" bucket', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup('tagA'),
          target: undoneGroup(NO_TAG_GROUP_ID),
          dragged: { id: 't1', parentId: null, tagIds: ['tagA', 'tagB'] },
        }),
      );

      expect(taskService.updateTags).toHaveBeenCalledTimes(1);
      const [task, newTags] = taskService.updateTags.calls.mostRecent().args;
      expect(task.id).toBe('t1');
      expect(newTags).toEqual([]);
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('appends the target tag even if the task already has it (relies on updateTags de-dupe)', async () => {
      // _retagAcrossGroups does not de-dupe itself — it trusts updateTags' unique().
      await component.drop(
        dropEvent({
          previous: undoneGroup('tagA'),
          target: undoneGroup('tagB'),
          dragged: { id: 't1', parentId: null, tagIds: ['tagA', 'tagB'] },
        }),
      );

      const [, newTags] = taskService.updateTags.calls.mostRecent().args;
      // Source 'tagA' dropped, 'tagB' appended → duplicate left for updateTags to collapse.
      expect(newTags).toEqual(['tagB', 'tagB']);
    });

    it('adds the target tag (no removal) when dragging from an ambiguous/unknown source bucket (src null)', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup(null),
          target: undoneGroup('tagB'),
          dragged: { id: 't1', parentId: null, tagIds: ['tagX'] },
        }),
      );

      expect(taskService.updateTags).toHaveBeenCalledTimes(1);
      const [, newTags] = taskService.updateTags.calls.mostRecent().args;
      // Source bucket has no single tag to drop → only the target is appended.
      expect(newTags).toEqual(['tagX', 'tagB']);
    });

    it('does NOT retag when dropping into a no-single-tag bucket (target null)', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup('tagA'),
          target: undoneGroup(null),
          dragged: { id: 't1', parentId: null, tagIds: ['tagA'] },
        }),
      );

      expect(taskService.updateTags).not.toHaveBeenCalled();
      // Falls through to a normal reorder within the today list.
      expectReorderDispatched();
    });

    it('does NOT retag when reordering within the same tag group', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup('tagA'),
          target: undoneGroup('tagA', [{ id: 'other' }]),
          dragged: { id: 't1', parentId: null, tagIds: ['tagA'] },
        }),
      );

      expect(taskService.updateTags).not.toHaveBeenCalled();
      expectReorderDispatched();
    });

    it('does NOT retag outside the grouped-by-tag view (groupTagId undefined)', async () => {
      await component.drop(
        dropEvent({
          previous: undoneGroup(undefined),
          target: undoneGroup(undefined),
          dragged: { id: 't1', parentId: null, tagIds: ['tagA'] },
        }),
      );

      expect(taskService.updateTags).not.toHaveBeenCalled();
      expectReorderDispatched();
    });
  });
});
