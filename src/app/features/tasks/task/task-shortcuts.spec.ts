import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { DateAdapter } from '@angular/material/core';
import { PlannerActions } from '../../planner/store/planner.actions';
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

describe('TaskComponent shortcut handling', () => {
  let fixture: import('@angular/core/testing').ComponentFixture<TaskComponent>;
  let component: TaskComponent;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
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
            'getProjectsWithoutId$',
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

    spyOn<any>(component, '_getPreviousTaskEl').and.returnValue(undefined);
    spyOn<any>(component, '_focusTaskHost').and.stub();
  });

  it('deletes on Escape for freshly created empty subtask', () => {
    component.updateTaskTitleIfChanged({
      newVal: '',
      wasChanged: false,
      submitTrigger: 'escape',
    });

    expect(taskServiceSpy.remove).toHaveBeenCalledWith(component.task());
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

  it('adds a sibling subtask on Mod+Enter when editing a subtask', () => {
    fixture.componentRef.setInput('task', createSubTask('Existing subtask'));

    component.updateTaskTitleIfChanged({
      newVal: 'Existing subtask',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledWith('parent-1');
  });

  it('adds a child subtask on Mod+Enter when editing a top-level task', () => {
    fixture.componentRef.setInput('task', createTopLevelTask('Top-level task'));

    component.updateTaskTitleIfChanged({
      newVal: 'Top-level task',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledWith('top-1');
  });

  it('persists the typed title before spawning a sibling on Mod+Enter', () => {
    fixture.componentRef.setInput('task', createSubTask(''));

    component.updateTaskTitleIfChanged({
      newVal: 'New subtask',
      wasChanged: true,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.update).toHaveBeenCalledWith('sub-1', {
      title: 'New subtask',
    });
    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledWith('parent-1');
  });

  it('expands hidden subtasks before adding when the parent has HideAll set', () => {
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
    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledWith('top-1');
  });

  it('does not expand subtasks when only HideDone is set (new task is not done)', () => {
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
    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledWith('top-1');
  });

  it('does not expand subtasks when subtasks are already visible', () => {
    fixture.componentRef.setInput('task', createTopLevelTask('Parent'));

    component.updateTaskTitleIfChanged({
      newVal: 'Parent',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.showSubTasks).not.toHaveBeenCalled();
    expect(taskServiceSpy.addSubTaskTo).toHaveBeenCalledWith('top-1');
  });

  it('focuses an existing empty child instead of spawning a new one (parent)', () => {
    taskServiceSpy.getByIdWithSubTaskData$.and.returnValue(
      of({
        ...DEFAULT_TASK,
        id: 'top-1',
        title: 'Parent',
        subTasks: [
          { ...DEFAULT_TASK, id: 'child-1', title: 'Filled', parentId: 'top-1' },
          { ...DEFAULT_TASK, id: 'child-2', title: '', parentId: 'top-1' },
        ],
        subTaskIds: ['child-1', 'child-2'],
      } as unknown as TaskWithSubTasks),
    );
    fixture.componentRef.setInput('task', createTopLevelTask('Parent'));

    component.updateTaskTitleIfChanged({
      newVal: 'Parent',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('focuses an existing empty sibling instead of spawning a new one (subtask)', () => {
    taskServiceSpy.getByIdWithSubTaskData$.and.returnValue(
      of({
        ...DEFAULT_TASK,
        id: 'parent-1',
        title: 'Parent',
        subTasks: [
          { ...DEFAULT_TASK, id: 'sub-1', title: 'Existing', parentId: 'parent-1' },
          { ...DEFAULT_TASK, id: 'sub-2', title: '', parentId: 'parent-1' },
        ],
        subTaskIds: ['sub-1', 'sub-2'],
      } as unknown as TaskWithSubTasks),
    );
    fixture.componentRef.setInput('task', createSubTask('Existing'));

    component.updateTaskTitleIfChanged({
      newVal: 'Existing',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

    expect(taskServiceSpy.addSubTaskTo).not.toHaveBeenCalled();
  });

  it('no-ops on Mod+Enter when current subtask is the only empty one', () => {
    fixture.componentRef.setInput('task', createSubTask(''));

    component.updateTaskTitleIfChanged({
      newVal: '',
      wasChanged: false,
      submitTrigger: 'modEnter',
    });

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
});
