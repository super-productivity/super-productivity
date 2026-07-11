import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Location } from '@angular/common';
import { MatDialog, MatDialogState } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DialogFullscreenMarkdownComponent } from '../../../ui/dialog-fullscreen-markdown/dialog-fullscreen-markdown.component';
import { DateAdapter } from '@angular/material/core';
import { PlannerActions } from '../../planner/store/planner.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { DateService } from '../../../core/date/date.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { ProjectService } from '../../project/project.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { TaskAttachmentService } from '../task-attachment/task-attachment.service';
import { TaskFocusService } from '../task-focus.service';
import { DEFAULT_TASK, HideSubTasksMode, TaskWithSubTasks } from '../task.model';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskComponent } from './task.component';
import { SnackService } from '../../../core/snack/snack.service';
import { TranslateService } from '@ngx-translate/core';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { PlannerService } from '../../planner/planner.service';
import { AddSubtaskInputService } from '../add-subtask-input/add-subtask-input.service';

describe('TaskComponent shortcut handling', () => {
  let fixture: import('@angular/core/testing').ComponentFixture<TaskComponent>;
  let component: TaskComponent;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let addSubtaskInputServiceSpy: jasmine.SpyObj<AddSubtaskInputService>;
  let storeSpy: jasmine.SpyObj<Store>;

  const createSubTask = (title: string): TaskWithSubTasks =>
    ({
      ...DEFAULT_TASK,
      id: 'sub-1',
      title,
      parentId: 'parent-1',
      projectId: 'project-1',
      subTasks: [],
      subTaskIds: [],
      tagIds: [],
    }) as TaskWithSubTasks;

  const createTopLevelTask = (title: string): TaskWithSubTasks =>
    ({
      ...DEFAULT_TASK,
      id: 'top-1',
      title,
      parentId: undefined,
      projectId: 'project-1',
      subTasks: [],
      subTaskIds: [],
      tagIds: [],
    }) as TaskWithSubTasks;

  beforeEach(async () => {
    taskServiceSpy = jasmine.createSpyObj<TaskService>(
      'TaskService',
      [
        'update',
        'remove',
        'addSubTaskTo',
        'setSelectedId',
        'toggleSubTaskMode',
        'showSubTasks',
        'toggleDoneWithAnimation',
        'moveUp',
        'moveDown',
        'moveToTop',
        'moveToBottom',
        'setCurrentId',
        'pauseCurrent',
        'getByIdWithSubTaskData$',
        'focusTaskById',
        'scheduleTask',
      ],
      {
        currentTaskId: signal<string | null>(null),
        selectedTaskId: signal<string | null>(null),
        todayListSet: signal<Set<string>>(new Set<string>()),
        timeConflictTaskIds: signal<Set<string>>(new Set<string>()),
      },
    );
    // Default: any parent lookup returns an empty-subTasks shell.
    // Individual specs may override via .and.returnValue(of({...})).
    taskServiceSpy.getByIdWithSubTaskData$.and.callFake((id: string) =>
      of({
        ...DEFAULT_TASK,
        id,
        title: 'Parent',
        subTasks: [],
        subTaskIds: [],
      } as unknown as TaskWithSubTasks),
    );
    addSubtaskInputServiceSpy = jasmine.createSpyObj<AddSubtaskInputService>(
      'AddSubtaskInputService',
      ['requestOpen', 'consume'],
      {
        openRequest: signal(null),
      },
    );
    storeSpy = jasmine.createSpyObj<Store>('Store', ['dispatch', 'select']);
    storeSpy.select.and.returnValue(of(new Set<string>()));

    await TestBed.configureTestingModule({
      imports: [TaskComponent],
      providers: [
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: TaskRepeatCfgService,
          useValue: jasmine.createSpyObj('TaskRepeatCfgService', [
            'getTaskRepeatCfgById$',
            'updateTaskRepeatCfg',
          ]),
        },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: GlobalConfigService,
          useValue: jasmine.createSpyObj('GlobalConfigService', ['cfg'], {
            cfg: () => ({ keyboard: {}, tasks: {}, reminder: {} }),
          }),
        },
        {
          provide: TaskAttachmentService,
          useValue: jasmine.createSpyObj('TaskAttachmentService', [
            'createFromDrop',
            'addAttachment',
          ]),
        },
        { provide: Store, useValue: storeSpy },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
        {
          provide: LocaleDatePipe,
          useValue: jasmine.createSpyObj('LocaleDatePipe', ['transform']),
        },
        {
          provide: PlannerService,
          useValue: jasmine.createSpyObj('PlannerService', ['getSnackExtraStr']),
        },
        {
          provide: ProjectService,
          useValue: jasmine.createSpyObj('ProjectService', [
            'getProjectsWithoutIdInTreeOrder$',
            'moveTaskToBacklog',
            'moveTaskToTodayList',
            'getByIdOnce$',
          ]),
        },
        {
          provide: TaskFocusService,
          useValue: {
            focusedTaskId: signal<string | null>(null),
            lastFocusedTaskComponent: signal<unknown | null>(null),
          },
        },
        { provide: AddSubtaskInputService, useValue: addSubtaskInputServiceSpy },
        {
          provide: DateService,
          useValue: jasmine.createSpyObj(
            'DateService',
            ['isToday', 'getLogicalTodayDate'],
            {
              isToday: () => false,
            },
          ),
        },
        {
          provide: GlobalTrackingIntervalService,
          useValue: jasmine.createSpyObj('GlobalTrackingIntervalService', [], {
            todayDateStr: signal('2026-05-05'),
          }),
        },
        {
          provide: LayoutService,
          useValue: jasmine.createSpyObj('LayoutService', [], {
            isXs: signal(false),
          }),
        },
        {
          provide: WorkContextService,
          useValue: {
            isTodayList: signal(false),
          },
        },
        {
          provide: DateAdapter,
          useValue: jasmine.createSpyObj('DateAdapter', [
            'getFirstDayOfWeek',
            'getDayOfWeek',
          ]),
        },
      ],
    })
      .overrideComponent(TaskComponent, {
        set: { template: '' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', createSubTask(''));
    fixture.componentRef.setInput('isInSubTaskList', true);
    fixture.componentRef.setInput('isBacklog', false);
  });

  it('does not delete an empty subtask on Escape', () => {
    component.updateTaskTitleIfChanged({
      newVal: '',
      wasChanged: false,
      submitTrigger: 'escape',
    });

    expect(taskServiceSpy.remove).not.toHaveBeenCalled();
  });

  // Guards against a future revert to a direct _matDialog.open that would
  // reintroduce the resize/back data loss (#8434): the helper always disables
  // closeOnNavigation.
  it('opens the fullscreen notes editor through the nav-persisting helper', () => {
    // The helper subscribes to the real Location to close-on-navigation; with
    // the suite's `destroyAfterEach: false` an un-torn-down subscription would
    // outlive this spec and fire on a later test's popstate (#8434). Stub
    // `subscribe` so no global listener leaks past this spec.
    spyOn(TestBed.inject(Location), 'subscribe').and.returnValue({
      unsubscribe: () => {},
    } as never);
    const matDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;
    matDialog.open.and.returnValue({
      afterClosed: () => of(),
      getState: () => MatDialogState.OPEN,
      componentInstance: { close: () => {} },
    } as never);

    component.openNotesFullscreen();

    const [comp, config] = matDialog.open.calls.mostRecent().args;
    expect(comp).toBe(DialogFullscreenMarkdownComponent);
    expect(config?.closeOnNavigation).toBe(false);
  });

  it('does NOT delete on Escape for existing subtask with cleared title', () => {
    fixture.componentRef.setInput('task', createSubTask('Existing subtask'));

    component.updateTaskTitleIfChanged({
      newVal: '',
      wasChanged: true,
      submitTrigger: 'escape',
    });

    expect(taskServiceSpy.update).toHaveBeenCalledWith('sub-1', { title: '' });
    expect(taskServiceSpy.remove).not.toHaveBeenCalled();
  });

  it('opens the parent draft input on Mod+Enter when editing a subtask', () => {
    fixture.componentRef.setInput('task', createSubTask('Existing subtask'));

    component.updateTaskTitleIfChanged({
      newVal: 'Existing subtask',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('parent-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('opens the child draft input on Mod+Enter when editing a top-level task', () => {
    fixture.componentRef.setInput('task', createTopLevelTask('Top-level task'));

    component.updateTaskTitleIfChanged({
      newVal: 'Top-level task',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('top-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('persists the typed title before opening a sibling draft input on Mod+Enter', () => {
    fixture.componentRef.setInput('task', createSubTask(''));

    component.updateTaskTitleIfChanged({
      newVal: 'New subtask',
      wasChanged: true,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.update).toHaveBeenCalledWith('sub-1', {
      title: 'New subtask',
    });
    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('parent-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('does not spawn a sibling on plain Enter when editing an existing subtask', () => {
    fixture.componentRef.setInput('task', createSubTask('Existing subtask'));

    component.updateTaskTitleIfChanged({
      newVal: 'Renamed subtask',
      wasChanged: true,
      submitTrigger: 'enter',
    });

    expect(taskServiceSpy.update).toHaveBeenCalledWith('sub-1', {
      title: 'Renamed subtask',
    });
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(addSubtaskInputServiceSpy.requestOpen).not.toHaveBeenCalled();
  });

  it('does not spawn a sibling on plain Enter when saving a previously empty subtask', () => {
    fixture.componentRef.setInput('task', createSubTask(''));

    component.updateTaskTitleIfChanged({
      newVal: 'New subtask',
      wasChanged: true,
      submitTrigger: 'enter',
    });

    expect(taskServiceSpy.update).toHaveBeenCalledWith('sub-1', {
      title: 'New subtask',
    });
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(addSubtaskInputServiceSpy.requestOpen).not.toHaveBeenCalled();
  });

  it('does not spawn a child on plain Enter when editing a top-level task', () => {
    fixture.componentRef.setInput('task', createTopLevelTask(''));

    component.updateTaskTitleIfChanged({
      newVal: 'New top-level task title',
      wasChanged: true,
      submitTrigger: 'enter',
    });

    expect(taskServiceSpy.update).toHaveBeenCalledWith('top-1', {
      title: 'New top-level task title',
    });
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
    expect(addSubtaskInputServiceSpy.requestOpen).not.toHaveBeenCalled();
  });

  it('expands hidden subtasks before opening the child draft input', () => {
    const parent = {
      ...createTopLevelTask('Parent'),
      _hideSubTasksMode: HideSubTasksMode.HideAll,
    } as TaskWithSubTasks;
    fixture.componentRef.setInput('task', parent);

    component.updateTaskTitleIfChanged({
      newVal: 'Parent',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.showSubTasks).toHaveBeenCalledWith('top-1');
    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('top-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('does not expand subtasks when only HideDone is set', () => {
    const parent = {
      ...createTopLevelTask('Parent'),
      _hideSubTasksMode: HideSubTasksMode.HideDone,
    } as TaskWithSubTasks;
    fixture.componentRef.setInput('task', parent);

    component.updateTaskTitleIfChanged({
      newVal: 'Parent',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.showSubTasks).not.toHaveBeenCalled();
    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('top-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('does not expand subtasks when subtasks are already visible', () => {
    fixture.componentRef.setInput('task', createTopLevelTask('Parent'));

    component.updateTaskTitleIfChanged({
      newVal: 'Parent',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.showSubTasks).not.toHaveBeenCalled();
    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('top-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('opens the draft input when addSubTask is called directly', () => {
    fixture.componentRef.setInput('task', createSubTask('Existing subtask'));

    component.addSubTask();

    expect(addSubtaskInputServiceSpy.requestOpen).toHaveBeenCalledWith('parent-1');
    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  describe('Scheduling shortcuts', () => {
    let dateService: jasmine.SpyObj<DateService>;
    let dateAdapter: jasmine.SpyObj<DateAdapter<unknown>>;
    let plannerService: jasmine.SpyObj<PlannerService>;

    beforeEach(() => {
      dateService = TestBed.inject(DateService) as jasmine.SpyObj<DateService>;
      dateAdapter = TestBed.inject(DateAdapter) as jasmine.SpyObj<DateAdapter<unknown>>;
      plannerService = TestBed.inject(PlannerService) as jasmine.SpyObj<PlannerService>;
      // Mock "logical today" to 2026-06-01 (a Monday)
      dateService.getLogicalTodayDate.and.returnValue(new Date('2026-06-01T12:00:00'));
      dateAdapter.getDayOfWeek.and.callFake((d: any) => (d as Date).getDay());
      dateAdapter.getFirstDayOfWeek.and.returnValue(1); // Monday
      plannerService.getSnackExtraStr.and.returnValue(Promise.resolve(''));
    });

    it('schedules for tomorrow', () => {
      component.scheduleTaskTomorrow();

      expect(storeSpy.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: component.task() as any,
          day: '2026-06-02',
          isShowSnack: true,
        }),
      );
    });

    it('schedules for next week (next Monday)', () => {
      component.scheduleTaskNextWeek();

      // Next week from Monday June 1st should be June 8th
      expect(storeSpy.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: component.task() as any,
          day: '2026-06-08',
          isShowSnack: true,
        }),
      );
    });

    it('schedules for next week (from Sunday, next Monday)', () => {
      dateService.getLogicalTodayDate.and.returnValue(new Date('2026-06-07T12:00:00')); // Sunday

      component.scheduleTaskNextWeek();

      // Next week from Sunday June 7th (first day Monday) should be June 8th
      expect(storeSpy.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: component.task() as any,
          day: '2026-06-08',
          isShowSnack: true,
        }),
      );
    });

    it('schedules for next week (from Sunday, next Monday) - US locale (Sunday first)', () => {
      dateAdapter.getFirstDayOfWeek.and.returnValue(0); // Sunday
      dateService.getLogicalTodayDate.and.returnValue(new Date('2026-06-07T12:00:00')); // Sunday

      component.scheduleTaskNextWeek();

      // Next week from Sunday June 7th (first day Sunday) should be June 14th
      expect(storeSpy.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: component.task() as any,
          day: '2026-06-14',
          isShowSnack: true,
        }),
      );
    });

    it('schedules for next month (first of next month)', () => {
      component.scheduleTaskNextMonth();

      expect(storeSpy.dispatch).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: component.task() as any,
          day: '2026-07-01',
          isShowSnack: true,
        }),
      );
    });

    it('preserves time and reminder when scheduling a timed task for tomorrow', async () => {
      const timedTask = {
        ...component.task(),
        dueWithTime: new Date('2026-06-01T10:00:00').getTime(),
      };
      fixture.componentRef.setInput('task', timedTask);

      await component.scheduleTaskTomorrow();

      // Should call taskService.scheduleTask instead of dispatching planTaskForDay
      // June 2nd at 10:00:00
      expect(taskServiceSpy.scheduleTask).toHaveBeenCalledWith(
        timedTask as any,
        new Date('2026-06-02T10:00:00').getTime(),
        jasmine.any(String),
        false,
      );
      expect(TestBed.inject(SnackService).open).toHaveBeenCalled();
      expect(storeSpy.dispatch).not.toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({
          task: timedTask as any,
          day: '2026-06-02',
          isShowSnack: true,
        }),
      );
    });
  });

  describe('add-subtask input close', () => {
    it('returns focus to the originating task when cancelled via Escape', fakeAsync(() => {
      const focusByIdSpy = spyOn<any>(component, '_focusTaskById');
      component['_subtaskInputOriginTaskId'] = 'origin-1';
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('escape');
      tick();

      expect(component.isAddSubtaskInputVisible()).toBe(false);
      expect(focusByIdSpy).toHaveBeenCalledWith('origin-1');
    }));

    it('falls back to this row when no origin task was captured', fakeAsync(() => {
      const focusByIdSpy = spyOn<any>(component, '_focusTaskById');
      component['_subtaskInputOriginTaskId'] = null;

      component.onAddSubtaskInputClosed('escape');
      tick();

      expect(focusByIdSpy).toHaveBeenCalledWith(component.task().id);
    }));

    it('does not refocus any task when closed via blur', fakeAsync(() => {
      const focusByIdSpy = spyOn<any>(component, '_focusTaskById');
      component['_subtaskInputOriginTaskId'] = 'origin-1';
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('blur');
      tick();

      expect(component.isAddSubtaskInputVisible()).toBe(false);
      expect(focusByIdSpy).not.toHaveBeenCalled();
    }));

    it('focuses the last visible subtask on previous navigation', fakeAsync(() => {
      const host = fixture.nativeElement as HTMLElement;
      const firstSubtask = document.createElement('task');
      const lastSubtask = document.createElement('task');
      firstSubtask.tabIndex = 0;
      lastSubtask.tabIndex = 0;
      host.append(firstSubtask, lastSubtask);
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('prev');
      tick();

      expect(document.activeElement).toBe(lastSubtask);
    }));

    it('focuses the parent task on previous navigation when it has no visible subtasks', fakeAsync(() => {
      // The overridden empty test template uses a generic Angular root element,
      // so mirror the real <task tabindex="0"> host binding explicitly.
      (fixture.nativeElement as HTMLElement).tabIndex = 0;
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('prev');
      tick();

      expect(document.activeElement).toBe(fixture.nativeElement);
    }));

    it('focuses the next task after the parent and its subtasks', fakeAsync(() => {
      const host = fixture.nativeElement as HTMLElement;
      const subtask = document.createElement('task');
      const nextTask = document.createElement('task');
      subtask.tabIndex = 0;
      nextTask.tabIndex = 0;
      host.append(subtask);
      host.after(nextTask);
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('next');
      tick();

      expect(document.activeElement).toBe(nextTask);
      nextTask.remove();
    }));

    it('keeps focus on the last visible row when there is no next task', fakeAsync(() => {
      const host = fixture.nativeElement as HTMLElement;
      const lastSubtask = document.createElement('task');
      lastSubtask.tabIndex = 0;
      host.append(lastSubtask);
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('next');
      tick();

      expect(document.activeElement).toBe(lastSubtask);
    }));

    it('does not navigate into task copies rendered in the detail panel', fakeAsync(() => {
      const host = fixture.nativeElement as HTMLElement;
      const lastSubtask = document.createElement('task');
      const detailPanel = document.createElement('task-detail-panel');
      const duplicateTask = document.createElement('task');
      lastSubtask.tabIndex = 0;
      duplicateTask.tabIndex = 0;
      host.append(lastSubtask);
      detailPanel.append(duplicateTask);
      host.after(detailPanel);
      component.isAddSubtaskInputVisible.set(true);

      component.onAddSubtaskInputClosed('next');
      tick();

      expect(document.activeElement).toBe(lastSubtask);
      detailPanel.remove();
    }));
  });

  describe('moveToToday overdue branch (#8851)', () => {
    let dateService: jasmine.SpyObj<DateService>;
    let projectService: jasmine.SpyObj<ProjectService>;

    beforeEach(() => {
      dateService = TestBed.inject(DateService) as jasmine.SpyObj<DateService>;
      projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
      (dateService as any).todayStr = jasmine
        .createSpy('todayStr')
        .and.returnValue('2026-06-01');
      (dateService as any).getStartOfNextDayDiffMs = jasmine
        .createSpy('getStartOfNextDayDiffMs')
        .and.returnValue(0);
    });

    it('schedules an overdue task for today instead of a position-only move', () => {
      fixture.componentRef.setInput('task', {
        ...createTopLevelTask('Overdue'),
        dueDay: '2026-05-30',
      });
      storeSpy.dispatch.calls.reset();

      component.moveToToday();

      expect(storeSpy.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.planTasksForToday({
          taskIds: ['top-1'],
          today: '2026-06-01',
          startOfNextDayDiffMs: 0,
          parentTaskMap: { ['top-1']: undefined },
        }),
      );
      expect(projectService.moveTaskToTodayList).not.toHaveBeenCalled();
    });

    it('keeps the position-only move for a non-overdue task (#8592)', () => {
      fixture.componentRef.setInput('task', {
        ...createTopLevelTask('Not overdue'),
        dueDay: undefined,
        dueWithTime: undefined,
      });
      storeSpy.dispatch.calls.reset();

      component.moveToToday();

      expect(projectService.moveTaskToTodayList).toHaveBeenCalledWith(
        'top-1',
        'project-1',
      );
      expect(storeSpy.dispatch).not.toHaveBeenCalled();
    });

    it('keeps the position-only move for a done task with a stale past dueDay', () => {
      // A done task can sit in the backlog with an old dueDay; it must take the
      // backlog→regular position-only move, not be re-added to Today.
      fixture.componentRef.setInput('task', {
        ...createTopLevelTask('Done + overdue'),
        isDone: true,
        dueDay: '2026-05-30',
      });
      storeSpy.dispatch.calls.reset();

      component.moveToToday();

      expect(projectService.moveTaskToTodayList).toHaveBeenCalledWith(
        'top-1',
        'project-1',
      );
      expect(storeSpy.dispatch).not.toHaveBeenCalled();
    });
  });
});
