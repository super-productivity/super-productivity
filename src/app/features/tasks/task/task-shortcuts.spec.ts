import { signal, WritableSignal } from '@angular/core';
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
import {
  DEFAULT_TASK,
  HideSubTasksMode,
  TaskDetailTargetPanel,
  TaskWithSubTasks,
} from '../task.model';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskComponent } from './task.component';
import { SnackService } from '../../../core/snack/snack.service';
import { TranslateService } from '@ngx-translate/core';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { PlannerService } from '../../planner/planner.service';
import { AddSubtaskInputService } from '../add-subtask-input/add-subtask-input.service';
import { TaskDuplicateService } from '../task-duplicate.service';
import { TaskMultiSelectService } from '../task-multi-select.service';

describe('TaskComponent shortcut handling', () => {
  let fixture: import('@angular/core/testing').ComponentFixture<TaskComponent>;
  let component: TaskComponent;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let taskDuplicateServiceSpy: jasmine.SpyObj<TaskDuplicateService>;
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
        'markIssueUpdatesAsRead',
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
    taskDuplicateServiceSpy = jasmine.createSpyObj<TaskDuplicateService>(
      'TaskDuplicateService',
      ['duplicate'],
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
        {
          provide: TaskMultiSelectService,
          useValue: {
            selectedIds: signal(new Set<string>()),
            anchorId: signal(null),
            count: signal(0),
            isActive: signal(false),
            menuOpenRequest: signal(null),
            has: () => false,
            toggle: () => {},
            selectRange: () => {},
            remove: () => {},
            removeWhenUnrendered: () => {},
            clear: () => {},
            requestMenuOpen: () => {},
            isBulkFeedbackSuppressed: signal(false),
            isSelecting: signal(false),
            isTouchSelectionMode: signal(false),
          },
        },

        { provide: TaskService, useValue: taskServiceSpy },
        { provide: TaskDuplicateService, useValue: taskDuplicateServiceSpy },
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

  describe('touch selection mode', () => {
    let multiSelect: {
      isTouchSelectionMode: WritableSignal<boolean>;
      toggle: jasmine.Spy;
    };

    // TestBed mounts the component on a <div>, so make the target resolve
    // `closest('task')` to that host; every other selector stays real.
    const clickHost = (target: HTMLElement): MouseEvent => {
      const host = fixture.nativeElement as HTMLElement;
      host.appendChild(target);
      const realClosest = target.closest.bind(target);
      target.closest = ((selector: string) =>
        selector === 'task' ? host : realClosest(selector)) as Element['closest'];
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      return ev;
    };

    beforeEach(() => {
      multiSelect = TestBed.inject(
        TaskMultiSelectService,
      ) as unknown as typeof multiSelect;
      multiSelect.toggle = jasmine.createSpy('toggle');
      multiSelect.isTouchSelectionMode.set(true);
      fixture.detectChanges();
    });

    it('a plain tap on the row toggles it in the selection', () => {
      const ev = clickHost(document.createElement('span'));
      expect(multiSelect.toggle).toHaveBeenCalledWith('sub-1');
      expect(ev.defaultPrevented).toBeTrue();
    });

    it('a tap on a real control keeps its own behaviour', () => {
      const ev = clickHost(document.createElement('button'));
      expect(multiSelect.toggle).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBeFalse();
    });

    it('a plain tap does nothing outside the mode', () => {
      multiSelect.isTouchSelectionMode.set(false);
      clickHost(document.createElement('span'));
      expect(multiSelect.toggle).not.toHaveBeenCalled();
    });
  });

  it('delegates duplication of the current task', () => {
    const task = createTopLevelTask('Task to duplicate');
    fixture.componentRef.setInput('task', task);

    component.duplicateTask();

    expect(taskDuplicateServiceSpy.duplicate).toHaveBeenCalledOnceWith(task);
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

  describe('scheduleForToday — Shift+T (#9563)', () => {
    // Must match the GlobalTrackingIntervalService.todayDateStr signal above,
    // which is what isScheduledToday() reads.
    const TODAY = '2026-05-05';
    let dateService: jasmine.SpyObj<DateService>;
    let projectService: jasmine.SpyObj<ProjectService>;

    const setTask = (task: Partial<TaskWithSubTasks>): void => {
      fixture.componentRef.setInput('task', {
        ...createTopLevelTask('Task'),
        dueDay: undefined,
        dueWithTime: undefined,
        ...task,
      });
      storeSpy.dispatch.calls.reset();
      projectService.moveTaskToTodayList.calls.reset();
    };

    const expectScheduledForToday = (): void =>
      expect(storeSpy.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.planTasksForToday({
          taskIds: ['top-1'],
          today: TODAY,
          startOfNextDayDiffMs: 0,
          // computed key: a quoted 'top-1' trips the naming-convention rule
          parentTaskMap: { ['top-1']: undefined },
        }),
      );

    beforeEach(() => {
      dateService = TestBed.inject(DateService) as jasmine.SpyObj<DateService>;
      projectService = TestBed.inject(ProjectService) as jasmine.SpyObj<ProjectService>;
      (dateService as any).todayStr = jasmine
        .createSpy('todayStr')
        .and.returnValue(TODAY);
      (dateService as any).getStartOfNextDayDiffMs = jasmine
        .createSpy('getStartOfNextDayDiffMs')
        .and.returnValue(0);
    });

    it('schedules an unscheduled task for today', () => {
      // The #9563/#9567 regression: this did only a backlog→regular move, which
      // the project reducer no-ops for a task already in the regular list — so
      // the shortcut did nothing at all.
      setTask({});

      component.scheduleForToday();

      expectScheduledForToday();
    });

    it('schedules an overdue task for today (#8851)', () => {
      setTask({ dueDay: '2026-04-30' });

      component.scheduleForToday();

      expectScheduledForToday();
    });

    it('never moves the task between the backlog and the regular list (#8592)', () => {
      // #8592 reported Shift+T (advertised in the "Move to regular list" menu
      // entry) changing the schedule as a side effect of a list move. The two
      // intents stay separate: this shortcut schedules and never repositions.
      setTask({});

      component.scheduleForToday();

      expect(projectService.moveTaskToTodayList).not.toHaveBeenCalled();
      expect(projectService.moveTaskToBacklog).not.toHaveBeenCalled();
    });

    it('leaves a task already scheduled for today untouched', () => {
      setTask({ dueDay: TODAY });

      component.scheduleForToday();

      expect(storeSpy.dispatch).not.toHaveBeenCalled();
    });

    it('keeps the reminder of a task due at a time today', () => {
      // planTasksForToday clears remindAt unconditionally, so re-planning a task
      // that is already on Today would silently drop its reminder.
      // isToday is installed as a property on the DateService mock, so it has
      // to be redefined rather than assigned.
      Object.defineProperty(dateService, 'isToday', {
        value: () => true,
        configurable: true,
      });
      setTask({ dueWithTime: 1746453600000, remindAt: 1746452000000 });

      component.scheduleForToday();

      expect(storeSpy.dispatch).not.toHaveBeenCalled();
    });

    it('does not put a done task on Today', () => {
      // Completion never synthesizes a dueDay; done tasks reach Today's Done
      // list via isDone. Dating one inflates the daily summary's done count.
      setTask({ isDone: true, dueDay: '2026-04-30' });

      component.scheduleForToday();

      expect(storeSpy.dispatch).not.toHaveBeenCalled();
    });

    describe('scheduleForTodayWithFocus', () => {
      it('keeps focus on the task instead of advancing to the next one', fakeAsync(() => {
        // Both reports describe the caret moving on to the next task, because
        // this used to call focusNext() unconditionally. Scheduling does not
        // remove the row from a normal list, so focus must stay on the task;
        // advancing is only the delayed fallback for a row that disappeared
        // (the overdue panels).
        // Asserted through the focus methods rather than document.activeElement:
        // the TestBed host is a <div>, so focusSelfOrNextIfNotPossible's
        // `tagName === 'task'` check can never pass here.
        const focusSelfSpy = spyOn(component, 'focusSelf');
        const focusNextSpy = spyOn(component, 'focusNext');
        setTask({});

        component.scheduleForTodayWithFocus();

        expect(focusSelfSpy).toHaveBeenCalled();
        expect(focusNextSpy).not.toHaveBeenCalled();
        tick(200); // flush the fallback timer
      }));

      it('still schedules the task', fakeAsync(() => {
        (fixture.nativeElement as HTMLElement).tabIndex = 0;
        setTask({});

        component.scheduleForTodayWithFocus();
        tick(200);

        expectScheduledForToday();
      }));
    });
  });

  describe('detail panel toggle button (#9850)', () => {
    const setTask = (overrides: Partial<TaskWithSubTasks>): void => {
      fixture.componentRef.setInput('task', {
        ...createTopLevelTask('Task'),
        ...overrides,
      });
      fixture.componentRef.setInput('isInSubTaskList', false);
      fixture.detectChanges();
    };
    const selectedTaskId = (): WritableSignal<string | null> =>
      taskServiceSpy.selectedTaskId as unknown as WritableSignal<string | null>;
    const isXs = (): WritableSignal<boolean> =>
      TestBed.inject(LayoutService).isXs as unknown as WritableSignal<boolean>;

    it('opens the notes section directly when the task has notes', () => {
      setTask({ notes: 'some notes' });

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(
        'top-1',
        TaskDetailTargetPanel.Notes,
      );
    });

    it('opens the notes section on mobile, where the bug was reported', () => {
      isXs().set(true);
      setTask({ notes: 'some notes' });

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(
        'top-1',
        TaskDetailTargetPanel.Notes,
      );
    });

    it('prefers the notes section for an issue-linked task that has notes', () => {
      setTask({ notes: 'some notes', issueId: 'GH-1', issueType: 'GITHUB' });

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(
        'top-1',
        TaskDetailTargetPanel.Notes,
      );
    });

    it('opens the default panel for an issue-linked task without notes', () => {
      setTask({ notes: '', issueId: 'GH-1', issueType: 'GITHUB' });

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(
        'top-1',
        TaskDetailTargetPanel.Default,
      );
    });

    it('opens the default panel and clears the badge in the issue-updated state', () => {
      setTask({ notes: 'some notes', issueId: 'GH-1', issueWasUpdated: true });

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.markIssueUpdatesAsRead).toHaveBeenCalledWith('top-1');
      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(
        'top-1',
        TaskDetailTargetPanel.Default,
      );
    });

    it('closes the panel when it is already open for this task', () => {
      setTask({ notes: 'some notes' });
      selectedTaskId().set('top-1');

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(null);
    });

    it('closes the panel on mobile where the icon stays "chat" while open', () => {
      isXs().set(true);
      setTask({ notes: 'some notes' });
      selectedTaskId().set('top-1');

      component.onToggleDetailPanelBtnClick();

      expect(taskServiceSpy.setSelectedId).toHaveBeenCalledWith(null);
    });
  });
});
