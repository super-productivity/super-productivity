import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskListComponent } from './task-list.component';
import { provideMockStore } from '@ngrx/store/testing';
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

describe('TaskListComponent', () => {
  let component: TaskListComponent;
  let fixture: ComponentFixture<TaskListComponent>;

  // Helper to create mock CdkDrag
  const createMockDrag = (task: { id: string; parentId: string | null }): CdkDrag =>
    ({
      data: task,
    }) as unknown as CdkDrag;

  // Helper to create mock CdkDropList with allTasks
  const createMockDrop = (
    listModelId: string,
    allTasks: Partial<TaskWithSubTasks>[] = [],
  ): CdkDropList =>
    ({
      data: { listModelId, allTasks },
    }) as unknown as CdkDropList;

  beforeEach(async () => {
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
      ],
    }).compileComponents();

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
        const drop = createMockDrop('parent1', [{ id: 'sub1' }, { id: 'sub2' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
      });

      it('should allow subtask to move between different parent subtask lists', () => {
        const subtask = { id: 'sub1', parentId: 'parent1' };
        const drag = createMockDrag(subtask);
        // Another task ID (not in PARENT_ALLOWED_LISTS)
        const drop = createMockDrop('parent2', [{ id: 'sub3' }]);
        expect(component.enterPredicate(drag, drop)).toBe(true);
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
        // Task ID = subtask list
        const drop = createMockDrop('some-task-id', []);
        expect(component.enterPredicate(drag, drop)).toBe(false);
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
});
