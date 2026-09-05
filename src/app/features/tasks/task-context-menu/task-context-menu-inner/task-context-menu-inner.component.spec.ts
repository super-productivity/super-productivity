import { TaskContextMenuInnerComponent } from './task-context-menu-inner.component';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TaskService } from '../../task.service';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { TaskRepeatCfgService } from '../../../task-repeat-cfg/task-repeat-cfg.service';
import { MatDialog } from '@angular/material/dialog';
import { IssueService } from '../../../issue/issue.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { ProjectService } from '../../../project/project.service';
import { GlobalConfigService } from '../../../config/global-config.service';
import { TagService } from '../../../tag/tag.service';
import { TranslateModule } from '@ngx-translate/core';
import { WorkContextService } from '../../../work-context/work-context.service';
import { TaskFocusService } from '../../task-focus.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { DateAdapter } from '@angular/material/core';
import { of, throwError } from 'rxjs';
import { selectTaskByIdWithSubTaskData } from '../../store/task.selectors';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { DateService } from '../../../../core/date/date.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AddSubtaskInputService } from '../../add-subtask-input/add-subtask-input.service';
import { Project } from '../../../project/project.model';
import { Tag } from '../../../tag/tag.model';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../task.model';
import { By } from '@angular/platform-browser';
import { MatMenu } from '@angular/material/menu';
import { TaskDuplicateService } from '../../task-duplicate.service';
import { TaskMultiSelectService } from '../../task-multi-select.service';

const projectInTreeOrder = (id: string, title: string): Project =>
  ({
    id,
    title,
    taskIds: [],
    backlogTaskIds: [],
    noteIds: [],
  }) as unknown as Project;

const tagInTreeOrder = (id: string, title: string): Tag =>
  ({
    id,
    title,
    taskIds: [],
    theme: { primary: '#999999' },
  }) as unknown as Tag;

describe('TaskContextMenuInnerComponent', () => {
  let component: TaskContextMenuInnerComponent;
  let fixture: ComponentFixture<TaskContextMenuInnerComponent>;
  let taskService: jasmine.SpyObj<TaskService>;
  let taskDuplicateService: jasmine.SpyObj<TaskDuplicateService>;
  let addSubtaskInputService: jasmine.SpyObj<AddSubtaskInputService>;
  let store: MockStore;
  let isTaskContextMenuOpen: ReturnType<typeof signal<boolean>>;
  let closeActiveTaskContextMenu: ReturnType<typeof signal<(() => void) | null>>;

  beforeEach(async () => {
    taskService = jasmine.createSpyObj('TaskService', [
      'currentTaskId',
      'selectedTaskId',
      'setSelectedId',
      'moveToProject',
      'getTasksWithSubTasksByRepeatCfgId$',
      'getArchiveTasksForRepeatCfgId',
    ]);
    taskService.currentTaskId.and.returnValue('some-id');
    taskDuplicateService = jasmine.createSpyObj<TaskDuplicateService>(
      'TaskDuplicateService',
      ['duplicate'],
    );
    addSubtaskInputService = jasmine.createSpyObj<AddSubtaskInputService>(
      'AddSubtaskInputService',
      ['requestOpen'],
    );
    isTaskContextMenuOpen = signal(false);
    closeActiveTaskContextMenu = signal<(() => void) | null>(null);

    await TestBed.configureTestingModule({
      imports: [
        TaskContextMenuInnerComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        { provide: TaskDuplicateService, useValue: taskDuplicateService },
        { provide: AddSubtaskInputService, useValue: addSubtaskInputService },
        {
          provide: TaskRepeatCfgService,
          useValue: {
            getTaskRepeatCfgById$: () => of(null),
            getTaskRepeatCfgByIdAllowUndefined$: () => of(undefined),
          },
        },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of() }) } },
        {
          provide: IssueService,
          useValue: { issueLink: () => Promise.resolve('') },
        },
        { provide: SnackService, useValue: {} },
        {
          provide: ProjectService,
          useValue: {
            getProjectsWithoutIdInTreeOrder$: () =>
              of([
                projectInTreeOrder('project-b', 'Project B'),
                projectInTreeOrder('project-a', 'Project A'),
              ]),
            getByIdOnce$: () => of({}),
            moveTaskToTodayList: () => {},
            moveTaskToBacklog: () => {},
          },
        },
        {
          provide: GlobalConfigService,
          useValue: {
            appFeatures: () => ({}),
            cfg: () => ({ reminder: {}, tasks: {} }),
          },
        },
        {
          provide: TagService,
          useValue: {
            tagsNoMyDayAndNoListInTreeOrder: signal([
              tagInTreeOrder('tag-b', 'Tag B'),
              tagInTreeOrder('tag-a', 'Tag A'),
            ]),
          },
        },
        { provide: WorkContextService, useValue: { activeWorkContext$: of({}) } },
        {
          provide: TaskFocusService,
          useValue: {
            focusedTaskId: { set: () => {} },
            isTaskContextMenuOpen,
            closeActiveTaskContextMenu,
          },
        },
        { provide: LocaleDatePipe, useValue: {} },
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 0 } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskContextMenuInnerComponent);
    component = fixture.componentInstance;
    component.task = {
      ...DEFAULT_TASK,
      id: 'task-default',
      title: 'Default Task',
      projectId: 'project-current',
    } as Task;
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    selectTaskByIdWithSubTaskData.release();
    store.resetSelectors();
  });

  describe('enterSelectionMode()', () => {
    it('enters touch selection mode with the task selected', () => {
      const multiSelect = TestBed.inject(TaskMultiSelectService);
      taskService.selectedTaskId.and.returnValue(null);
      component.enterSelectionMode();
      expect(multiSelect.isTouchSelectionMode()).toBeTrue();
      expect(multiSelect.has('task-default')).toBeTrue();
      expect(taskService.setSelectedId).not.toHaveBeenCalled();
      multiSelect.clear();
    });

    it('closes an open detail panel first', () => {
      const multiSelect = TestBed.inject(TaskMultiSelectService);
      taskService.selectedTaskId.and.returnValue('other-task');
      component.enterSelectionMode();
      expect(taskService.setSelectedId).toHaveBeenCalledWith(null);
      multiSelect.clear();
    });
  });

  describe('tree ordered dropdown data', () => {
    it('should expose move projects in the order provided by ProjectService', (done) => {
      component.taskSet = {
        ...DEFAULT_TASK,
        id: 'task-1',
        title: 'Task 1',
        projectId: 'project-current',
        tagIds: [],
        subTaskIds: [],
      } as unknown as Task;

      component.moveToProjectList$.subscribe((projects) => {
        expect(projects.map((project) => project.id)).toEqual(['project-b', 'project-a']);
        done();
      });
    });

    it('should expose toggle tags in the order provided by TagService', () => {
      expect(component.toggleTagList().map((tag) => tag.id)).toEqual(['tag-b', 'tag-a']);
    });
  });

  describe('duplicate()', () => {
    it('delegates a task without subtasks directly to TaskDuplicateService', async () => {
      const mockTask: Task = {
        ...DEFAULT_TASK,
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      };

      component.task = mockTask;

      await component.duplicate();

      expect(taskDuplicateService.duplicate).toHaveBeenCalledOnceWith({
        ...mockTask,
        subTasks: [],
      });
    });

    it('delegates the complete task tree to TaskDuplicateService', fakeAsync(() => {
      const mockTask: Task = {
        ...DEFAULT_TASK,
        id: 'PARENT_ID',
        title: 'Parent Task',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: ['SUB_ID'],
      };
      const mockTaskWithSubTasks: TaskWithSubTasks = {
        ...mockTask,
        subTasks: [
          {
            ...DEFAULT_TASK,
            id: 'SUB_ID',
            title: 'Sub Task',
            isDone: true,
            projectId: 'P1',
            timeEstimate: 3_600_000,
            notes: 'Some notes',
          },
        ],
      };

      component.task = mockTask;
      store.overrideSelector(selectTaskByIdWithSubTaskData, mockTaskWithSubTasks);

      void component.duplicate();
      tick(50); // for the delay(50) in _getTaskWithSubtasks

      expect(taskDuplicateService.duplicate).toHaveBeenCalledOnceWith(
        mockTaskWithSubTasks,
      );
    }));
  });

  describe('getElementById for task ID lookup', () => {
    it('registers its close callback when opened and clears it when closed', () => {
      const closeMenu = jasmine.createSpy('closeMenu');
      (
        component as unknown as {
          contextMenuTrigger: () => { closeMenu: () => void; openMenu: () => void };
        }
      ).contextMenuTrigger = () => ({ closeMenu, openMenu: () => {} });

      component.open();

      expect(closeActiveTaskContextMenu()).not.toBeNull();
      closeActiveTaskContextMenu()?.();
      expect(closeMenu).toHaveBeenCalled();

      component.onClose();
      expect(closeActiveTaskContextMenu()).toBeNull();
    });

    it('does not clear a newer menu registration when destroyed', () => {
      (
        component as unknown as {
          contextMenuTrigger: () => { closeMenu: () => void; openMenu: () => void };
        }
      ).contextMenuTrigger = () => ({ closeMenu: () => {}, openMenu: () => {} });
      component.open();
      const newerClose = (): void => {};
      closeActiveTaskContextMenu.set(newerClose);

      component.ngOnDestroy();

      expect(closeActiveTaskContextMenu()).toBe(newerClose);
    });

    it('should use getElementById for task ID in focusRelatedTaskOrNext', fakeAsync(() => {
      component.task = {
        id: 'task-with-{special}-chars',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      const getByIdSpy = spyOn(document, 'getElementById').and.returnValue(null);

      component.focusRelatedTaskOrNext();
      tick(100);

      expect(getByIdSpy).toHaveBeenCalledWith('t-task-with-{special}-chars');
    }));

    // Regression guard for #8533: focusing the task after the context menu
    // closes must never scroll the viewport. An action like "add to today"
    // relocates the task (Overdue -> Today), so a plain .focus() would yank the
    // list to the moved task. Focus is kept for keyboard continuity, but with
    // preventScroll so the user stays anchored where they acted.
    it('should focus the related task with preventScroll to avoid viewport jump', fakeAsync(() => {
      component.task = {
        id: 'T1',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      const focusSpy = jasmine.createSpy('focus');
      spyOn(document, 'getElementById').and.returnValue({
        focus: focusSpy,
      } as unknown as HTMLElement);

      component.focusRelatedTaskOrNext();
      tick(100);

      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    }));

    it('should restore external focus only after the root menu closes', fakeAsync(() => {
      component.task = {
        id: 'T1',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      const triggerFocusSpy = spyOn(trigger, 'focus');
      const getByIdSpy = spyOn(document, 'getElementById');

      component.open(undefined, false, trigger);
      fixture.detectChanges();
      const menus = fixture.debugElement.queryAll(By.directive(MatMenu));
      expect(menus.length).toBeGreaterThan(1);

      menus[1].injector.get(MatMenu).closed.emit();
      tick();

      expect(triggerFocusSpy).not.toHaveBeenCalled();
      expect(getByIdSpy).not.toHaveBeenCalled();

      component.onClose();
      tick();

      expect(triggerFocusSpy).toHaveBeenCalledOnceWith({ preventScroll: true });
      expect(getByIdSpy).not.toHaveBeenCalled();
      trigger.remove();
    }));
  });

  describe('focusFirstSubmenuItem()', () => {
    it('should focus the submenu so Material typeahead owns keyboard input', () => {
      const menu = jasmine.createSpyObj('MatMenu', ['focusFirstItem']);
      component.task = {
        id: 'T1',
        title: 'Test',
        projectId: 'P1',
        tagIds: [],
        subTaskIds: [],
      } as any;

      component.focusFirstSubmenuItem(menu);

      expect(menu.focusFirstItem).toHaveBeenCalledWith('program');
    });
  });

  describe('addSubTask()', () => {
    it('requests the inline subtask input for the parent task', () => {
      component.task = {
        id: 'SUB_ID',
        title: 'Subtask',
        parentId: 'PARENT_ID',
        tagIds: [],
        subTaskIds: [],
      } as any;

      component.addSubTask();

      expect(addSubtaskInputService.requestOpen).toHaveBeenCalledWith('PARENT_ID');
    });
  });

  // Moving a task between the backlog and the regular list is a list-position
  // change only; it must not touch the task's schedule (issue #8592).
  describe('moveToToday() / moveToBacklog() schedule preservation (#8592)', () => {
    let projectService: ProjectService;

    beforeEach(() => {
      projectService = TestBed.inject(ProjectService);
    });

    it('moveToToday() moves to the regular list without scheduling for today', () => {
      const moveSpy = spyOn(projectService, 'moveTaskToTodayList');
      const dispatchSpy = spyOn(store, 'dispatch');
      component.task = {
        ...DEFAULT_TASK,
        id: 'task-1',
        projectId: 'project-current',
      } as Task;

      component.moveToToday();

      expect(moveSpy).toHaveBeenCalledWith('task-1', 'project-current');
      const dispatchedTypes = dispatchSpy.calls
        .allArgs()
        .map((args) => (args[0] as unknown as { type: string }).type);
      expect(dispatchedTypes).not.toContain(TaskSharedActions.planTasksForToday.type);
    });

    it('moveToBacklog() moves to the backlog without clearing a schedule set for today', () => {
      const moveSpy = spyOn(projectService, 'moveTaskToBacklog');
      const dispatchSpy = spyOn(store, 'dispatch');
      component.task = {
        ...DEFAULT_TASK,
        id: 'task-1',
        projectId: 'project-current',
        dueDay: TestBed.inject(DateService).todayStr(),
      } as Task;

      component.moveToBacklog();

      expect(moveSpy).toHaveBeenCalledWith('task-1', 'project-current');
      const dispatchedTypes = dispatchSpy.calls
        .allArgs()
        .map((args) => (args[0] as unknown as { type: string }).type);
      expect(dispatchedTypes).not.toContain(TaskSharedActions.unscheduleTask.type);
    });
  });

  // #8715: a task can reference a repeat config that was already deleted (e.g.
  // via cross-client sync). Moving it must not throw ('Missing taskRepeatCfg')
  // and crash — it should fall back to a plain task move.
  describe('moveTaskToProject() with a deleted repeat config (#8715)', () => {
    it('falls back to a plain move instead of crashing on the missing config', fakeAsync(() => {
      const taskWithRepeat = {
        ...DEFAULT_TASK,
        id: 'task-repeat',
        title: 'Repeat Task',
        projectId: 'project-current',
        repeatCfgId: 'deleted-cfg',
      } as Task;
      component.task = taskWithRepeat;

      const taskWithSubTasks = { ...taskWithRepeat, subTasks: [] } as any;
      store.overrideSelector(selectTaskByIdWithSubTaskData, taskWithSubTasks);
      // config resolves to undefined (deleted); the other repeat lookups still run
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
        of([taskWithSubTasks]),
      );
      taskService.getArchiveTasksForRepeatCfgId.and.returnValue(Promise.resolve([]));
      // guard against regressing to the throwing selector (the #8715 root cause)
      const repeatCfgService = TestBed.inject(TaskRepeatCfgService);
      (
        repeatCfgService as unknown as { getTaskRepeatCfgById$: () => unknown }
      ).getTaskRepeatCfgById$ = () =>
        throwError(() => new Error('Missing taskRepeatCfg'));

      component.moveTaskToProject('project-b');
      tick(50); // _getTaskWithSubtasks delay(50)
      flush(); // focusRelatedTaskOrNext setTimeout

      expect(taskService.moveToProject).toHaveBeenCalledWith(
        taskWithSubTasks,
        'project-b',
      );
    }));
  });
});
