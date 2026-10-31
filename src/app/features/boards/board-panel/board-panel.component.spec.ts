import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardPanelComponent } from './board-panel.component';
import {
  BoardPanelCfg,
  BoardPanelCfgDeadlineState,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import { TaskCopy } from '../../tasks/task.model';
import { Store } from '@ngrx/store';
import { TaskService } from '../../tasks/task.service';
import { MatDialog } from '@angular/material/dialog';
import { of, ReplaySubject } from 'rxjs';
import {
  TranslateLoader,
  TranslateModule,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { PlannerTaskComponent } from '../../planner/planner-task/planner-task.component';
import { AddTaskInlineComponent } from '../../planner/add-task-inline/add-task-inline.component';
import { selectUnarchivedProjects } from '../../project/store/project.selectors';
import {
  selectAllTasksInActiveProjects,
  selectTaskById,
} from '../../tasks/store/task.selectors';
import { WorkContextService } from '../../work-context/work-context.service';
import { ProjectService } from '../../project/project.service';
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TODAY_TAG } from '../../tag/tag.const';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateService } from '../../../core/date/date.service';
import { DateAdapter } from '@angular/material/core';
import { DEFAULT_PANEL_CFG } from '../boards.const';
import { BoardsActions } from '../store/boards.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { selectStartOfNextDayDiffMs } from '../../../root-store/app-state/app-state.selectors';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DialogScheduleTaskComponent } from '../../planner/dialog-schedule-task/dialog-schedule-task.component';
import { DialogDeadlineComponent } from '../../tasks/dialog-deadline/dialog-deadline.component';
import { SnackService } from '../../../core/snack/snack.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { TaskBulkActionService } from '../../tasks/task-bulk-action.service';

const PLANNER_TASK_PROVIDERS = [
  {
    provide: GlobalConfigService,
    useValue: {
      cfg: () => null,
      localization: () => ({}),
      appFeatures: () => ({ isTimeTrackingEnabled: false }),
    },
  },
  {
    provide: DateService,
    useValue: {
      todayStr: () => '2026-09-12',
      getStartOfNextDayDiffMs: () => 0,
    },
  },
  {
    provide: GlobalTrackingIntervalService,
    useFactory: () => ({
      todayDateStr: signal('2026-09-12'),
      clockTimestamp: signal(new Date(2026, 8, 12, 12).getTime()),
      clockMinute: signal(Math.floor(new Date(2026, 8, 12, 12).getTime() / 60000)),
    }),
  },
  {
    provide: DateAdapter,
    useValue: { getFirstDayOfWeek: () => 1, getDayOfWeek: () => 1 },
  },
];

describe('BoardPanelComponent - Backlog Feature', () => {
  let component: BoardPanelComponent;
  let fixture: ComponentFixture<BoardPanelComponent>;
  let actions$: ReplaySubject<any>;

  const mockBacklogTaskId = 'backlog-task-1';
  const mockNonBacklogTaskId = 'regular-task-1';

  const mockPanelCfg: Partial<BoardPanelCfg> = {
    id: 'panel-1',
    title: 'Backlog Panel',
    taskIds: [mockBacklogTaskId, mockNonBacklogTaskId],
    backlogState: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
    includedTagIds: [],
    excludedTagIds: [],
    isParentTasksOnly: false,
    projectIds: [''],
  };

  const mockTasks: TaskCopy[] = [
    {
      id: mockBacklogTaskId,
      title: 'Backlog Task',
      projectId: 'p1',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: [],
      created: Date.now(),
      subTaskIds: [],
      dueDay: '2026-09-12',
    } as TaskCopy,
    {
      id: mockNonBacklogTaskId,
      title: 'Regular Task',
      projectId: 'p1',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: [],
      created: Date.now(),
      subTaskIds: [],
    } as TaskCopy,
  ];

  const mockProjects = [
    { id: 'p1', backlogTaskIds: [mockBacklogTaskId] },
    { id: 'p2', backlogTaskIds: [] },
  ];

  beforeEach(async () => {
    actions$ = new ReplaySubject(1);

    const storeMock = {
      select: (selectorFn: any) => {
        if (selectorFn === selectUnarchivedProjects) {
          return of(mockProjects);
        } else if (selectorFn === selectAllTasksInActiveProjects) {
          return of(mockTasks);
        }
        return of([]);
      },
      dispatch: jasmine.createSpy('dispatch'),
    };

    const workContextServiceMock = {};

    const projectServiceMock = {
      getProjectsWithoutId$: () => of([]),
    };

    await TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        ...PLANNER_TASK_PROVIDERS,
        provideMockStore({}),
        provideMockActions(() => actions$),
        { provide: Store, useValue: storeMock },
        { provide: TaskService, useValue: { currentTaskId: signal(null) } },
        { provide: MatDialog, useValue: {} },
        { provide: WorkContextService, useValue: workContextServiceMock },
        { provide: ProjectService, useValue: projectServiceMock },
      ],
    })
      .overrideComponent(PlannerTaskComponent, {
        set: {
          template: '<ng-content></ng-content><div>Mock Task</div>',
          inputs: ['task'],
        },
      })
      .overrideComponent(AddTaskInlineComponent, {
        set: {
          template: '<div>Mock Add Task</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPanelComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('panelCfg', mockPanelCfg as BoardPanelCfg);
    fixture.detectChanges();
  });

  it('keeps Board Today controls at the default color', () => {
    const task = component.tasks()[0];
    expect(component.scheduledDateColor(task)).toBe('');

    const button = fixture.nativeElement.querySelector(
      '.schedule-btn',
    ) as HTMLElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('data-scheduled-date-color')).toBe('');
    const icon = button!.querySelector('mat-icon') as HTMLElement;
    const badge = button!.querySelector('.time-badge') as HTMLElement;
    expect(getComputedStyle(badge).color).toBe(getComputedStyle(icon).color);
  });

  it('refreshes timed Board colors at expiry and suppresses them while tracking', () => {
    const interval = TestBed.inject(GlobalTrackingIntervalService) as unknown as {
      clockTimestamp: WritableSignal<number>;
    };
    const currentTaskId = TestBed.inject(TaskService).currentTaskId as WritableSignal<
      string | null
    >;
    const dueWithTime = new Date(2026, 8, 12, 12, 1).getTime();
    const task = { ...component.tasks()[0], dueDay: undefined, dueWithTime };
    expect(component.scheduledDateColor(task)).toBe('');
    interval.clockTimestamp.set(dueWithTime);
    expect(component.scheduledDateColor(task)).toBe('overdue');
    currentTaskId.set(task.id);
    expect(component.scheduledDateColor(task)).toBe('');
    currentTaskId.set(null);
    expect(component.scheduledDateColor(task)).toBe('overdue');
    expect(component.scheduledDateColor({ ...task, isDone: true })).toBe('');
    expect(component.scheduledDateColor({ ...task, dueWithTime: undefined })).toBe('');
  });

  it('should only include backlog tasks when backlogState is OnlyBacklog', () => {
    fixture.componentRef.setInput('panelCfg', {
      ...mockPanelCfg,
      backlogState: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
    } as BoardPanelCfg);
    fixture.detectChanges();
    const tasks = component.tasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(mockBacklogTaskId);
  });

  it('should exclude backlog tasks when backlogState is NoBacklog', () => {
    fixture.componentRef.setInput('panelCfg', {
      ...mockPanelCfg,
      backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
    } as BoardPanelCfg);
    fixture.detectChanges();
    const tasks = component.tasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(mockNonBacklogTaskId);
  });

  it('should include all tasks regardless of backlog when backlogState is All', () => {
    fixture.componentRef.setInput('panelCfg', {
      ...mockPanelCfg,
      backlogState: BoardPanelCfgTaskTypeFilter.All,
    } as BoardPanelCfg);
    fixture.detectChanges();
    const tasks = component.tasks();
    expect(tasks.length).toBe(2);
    expect(tasks.find((t) => t.id === mockBacklogTaskId)).toBeTruthy();
    expect(tasks.find((t) => t.id === mockNonBacklogTaskId)).toBeTruthy();
  });
});

describe('BoardPanelComponent - Hidden Project Backlog', () => {
  let component: BoardPanelComponent;
  let fixture: ComponentFixture<BoardPanelComponent>;
  let actions$: ReplaySubject<any>;

  const hiddenProjectBacklogTaskId = 'hidden-backlog-task';
  const hiddenProjectRegularTaskId = 'hidden-regular-task';
  const regularTaskId = 'regular-task';

  const mockPanelCfg: Partial<BoardPanelCfg> = {
    id: 'panel-1',
    title: 'Test Panel',
    taskIds: [],
    backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
    includedTagIds: [],
    excludedTagIds: [],
    isParentTasksOnly: false,
    projectIds: [''],
  };

  const mockTasks: TaskCopy[] = [
    {
      id: hiddenProjectBacklogTaskId,
      title: 'Task from hidden project backlog',
      projectId: 'hidden-project',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: ['important-tag'],
      created: Date.now(),
      subTaskIds: [],
    } as TaskCopy,
    {
      id: hiddenProjectRegularTaskId,
      title: 'Regular task from hidden project',
      projectId: 'hidden-project',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: ['important-tag'],
      created: Date.now(),
      subTaskIds: [],
    } as TaskCopy,
    {
      id: regularTaskId,
      title: 'Regular Task',
      projectId: 'visible-project',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: ['important-tag'],
      created: Date.now(),
      subTaskIds: [],
    } as TaskCopy,
  ];

  // Include hidden project in the list (simulates selectUnarchivedProjects including it)
  const mockProjects = [
    { id: 'visible-project', backlogTaskIds: [], isHiddenFromMenu: false },
    {
      id: 'hidden-project',
      backlogTaskIds: [hiddenProjectBacklogTaskId],
      isHiddenFromMenu: true,
    },
  ];

  beforeEach(async () => {
    actions$ = new ReplaySubject(1);

    const storeMock = {
      select: (selectorFn: any) => {
        if (selectorFn === selectUnarchivedProjects) {
          return of(mockProjects);
        } else if (selectorFn === selectAllTasksInActiveProjects) {
          return of(mockTasks);
        }
        return of([]);
      },
      dispatch: jasmine.createSpy('dispatch'),
    };

    await TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        ...PLANNER_TASK_PROVIDERS,
        provideMockStore({}),
        provideMockActions(() => actions$),
        { provide: Store, useValue: storeMock },
        { provide: TaskService, useValue: { currentTaskId: signal(null) } },
        { provide: MatDialog, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
      ],
    })
      .overrideComponent(PlannerTaskComponent, {
        set: { template: '<div>Mock Task</div>', inputs: ['task'] },
      })
      .overrideComponent(AddTaskInlineComponent, {
        set: { template: '<div>Mock Add Task</div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panelCfg', mockPanelCfg as BoardPanelCfg);
    fixture.detectChanges();
  });

  it('should include regular tasks from hidden projects when backlogState is NoBacklog', () => {
    fixture.componentRef.setInput('panelCfg', {
      ...mockPanelCfg,
      backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
    } as BoardPanelCfg);
    fixture.detectChanges();

    const tasks = component.tasks();
    expect(tasks.map((task) => task.id)).toEqual([
      hiddenProjectRegularTaskId,
      regularTaskId,
    ]);
    expect(tasks.find((t) => t.id === hiddenProjectBacklogTaskId)).toBeFalsy();
  });

  it('should include backlog tasks from hidden projects when backlogState is OnlyBacklog', () => {
    fixture.componentRef.setInput('panelCfg', {
      ...mockPanelCfg,
      backlogState: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
    } as BoardPanelCfg);
    fixture.detectChanges();

    const tasks = component.tasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(hiddenProjectBacklogTaskId);
  });
});

describe('BoardPanelComponent - Tag match mode, sort, inline-create computeds', () => {
  let component: BoardPanelComponent;
  let fixture: ComponentFixture<BoardPanelComponent>;
  let actions$: ReplaySubject<any>;

  const mkTask = (overrides: Partial<TaskCopy>): TaskCopy =>
    ({
      id: overrides.id || 't',
      title: 'Task',
      projectId: 'p1',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: [],
      created: Date.now(),
      subTaskIds: [],
      ...overrides,
    }) as TaskCopy;

  const setup = async (tasks: TaskCopy[]): Promise<void> => {
    actions$ = new ReplaySubject(1);
    const storeMock = {
      select: (selectorFn: any) => {
        if (selectorFn === selectUnarchivedProjects)
          return of([{ id: 'p1', backlogTaskIds: [] }]);
        if (selectorFn === selectAllTasksInActiveProjects) return of(tasks);
        return of([]);
      },
      dispatch: jasmine.createSpy('dispatch'),
    };

    await TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        ...PLANNER_TASK_PROVIDERS,
        provideMockStore({}),
        provideMockActions(() => actions$),
        { provide: Store, useValue: storeMock },
        { provide: TaskService, useValue: { currentTaskId: signal(null) } },
        { provide: MatDialog, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
      ],
    })
      .overrideComponent(PlannerTaskComponent, {
        set: { template: '<div>Mock Task</div>', inputs: ['task'] },
      })
      .overrideComponent(AddTaskInlineComponent, {
        set: { template: '<div>Mock Add Task</div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPanelComponent);
    component = fixture.componentInstance;
  };

  describe('includedTagsMatch', () => {
    it('defaults to "all" — task must have every required tag', async () => {
      await setup([
        mkTask({ id: 'hasBoth', tagIds: ['a', 'b'] }),
        mkTask({ id: 'hasOne', tagIds: ['a'] }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: ['a', 'b'],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['hasBoth']);
    });

    it('"any" admits a task that matches a single required tag', async () => {
      await setup([
        mkTask({ id: 'hasA', tagIds: ['a'] }),
        mkTask({ id: 'hasB', tagIds: ['b'] }),
        mkTask({ id: 'hasNone', tagIds: ['c'] }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: ['a', 'b'],
        includedTagsMatch: 'any',
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      const ids = component.tasks().map((t) => t.id);
      expect(ids).toContain('hasA');
      expect(ids).toContain('hasB');
      expect(ids).not.toContain('hasNone');
    });
  });

  describe('excludedTagsMatch', () => {
    it('defaults to "any" — any excluded tag disqualifies', async () => {
      await setup([
        mkTask({ id: 'keep', tagIds: ['a'] }),
        mkTask({ id: 'drop', tagIds: ['x'] }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: ['x', 'y'],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['keep']);
    });

    it('"all" excludes only tasks carrying every excluded tag', async () => {
      await setup([
        mkTask({ id: 'some', tagIds: ['x'] }),
        mkTask({ id: 'all', tagIds: ['x', 'y'] }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: ['x', 'y'],
        excludedTagsMatch: 'all',
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['some']);
    });
  });

  describe('multi-project filtering', () => {
    it('should include tasks matching any of the specified projectIds', async () => {
      await setup([
        mkTask({ id: 'p1-task', projectId: 'p1' }),
        mkTask({ id: 'p2-task', projectId: 'p2' }),
        mkTask({ id: 'other-task', projectId: 'other' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: ['p1', 'p2'],
      } as BoardPanelCfg);
      fixture.detectChanges();

      const ids = component.tasks().map((t) => t.id);
      expect(ids).toContain('p1-task');
      expect(ids).toContain('p2-task');
      expect(ids).not.toContain('other-task');
    });
  });

  describe('additionalTaskFields - projectId assignment', () => {
    it('assigns the first specific projectId when only specific projects are selected', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: ['p1', 'p2'],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.additionalTaskFields().projectId).toBe('p1');
    });

    it('does NOT assign a projectId when only "All Projects" ("") is selected', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.additionalTaskFields().projectId).toBeUndefined();
    });
  });

  describe('sortBy', () => {
    for (const sortBy of [undefined, 'title'] as const) {
      it(`preserves saved order and appends new tasks with sortBy=${sortBy}`, async () => {
        await setup([
          mkTask({ id: 'new-a' }),
          mkTask({ id: 'a' }),
          mkTask({ id: 'b' }),
          mkTask({ id: 'new-b' }),
        ]);
        fixture.componentRef.setInput('panelCfg', {
          ...DEFAULT_PANEL_CFG,
          taskIds: ['missing', 'b', 'a', 'b'],
          sortBy,
        });
        fixture.detectChanges();

        // All titles are equal: explicit sorting must retain the manual tie order.
        expect(component.tasks().map((t) => t.id)).toEqual(['b', 'a', 'new-a', 'new-b']);
      });
    }

    it('sorts by title ascending', async () => {
      await setup([
        mkTask({ id: 'c', title: 'Charlie' }),
        mkTask({ id: 'a', title: 'Alpha' }),
        mkTask({ id: 'b', title: 'Bravo' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
        sortBy: 'title',
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('sorts by timeEstimate descending', async () => {
      await setup([
        mkTask({ id: 'small', timeEstimate: 100 }),
        mkTask({ id: 'big', timeEstimate: 500 }),
        mkTask({ id: 'mid', timeEstimate: 300 }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
        sortBy: 'timeEstimate',
        sortDir: 'desc',
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['big', 'mid', 'small']);
    });
  });

  describe('isManualOrder', () => {
    it('is true when sortBy is absent', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.isManualOrder()).toBe(true);
    });

    it('is false when sortBy is set', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
        sortBy: 'title',
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.isManualOrder()).toBe(false);
    });
  });

  describe('tagsToAddForInlineCreate', () => {
    it('returns all required tags in default (all) mode', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: ['a', 'b'],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tagsToAddForInlineCreate()).toEqual(['a', 'b']);
    });

    it('returns only the first required tag in "any" mode', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: ['a', 'b'],
        includedTagsMatch: 'any',
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tagsToAddForInlineCreate()).toEqual(['a']);
    });
  });

  describe('tagsToRemoveForInlineCreate', () => {
    it('returns all excluded tags in default (any) mode', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: ['x', 'y'],
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tagsToRemoveForInlineCreate()).toEqual(['x', 'y']);
    });

    it('returns [] in "all" mode — avoids stripping tags the user types', async () => {
      await setup([]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: ['x', 'y'],
        excludedTagsMatch: 'all',
        taskDoneState: 1,
        scheduledState: 1,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tagsToRemoveForInlineCreate()).toEqual([]);
    });
  });
});

describe('BoardPanelComponent - drop()', () => {
  let component: BoardPanelComponent;
  let fixture: ComponentFixture<BoardPanelComponent>;
  let actions$: ReplaySubject<any>;
  let dispatchSpy: jasmine.Spy;
  let updateTagsSpy: jasmine.Spy;

  const mkTask = (overrides: Partial<TaskCopy>): TaskCopy =>
    ({
      id: overrides.id || 't',
      title: 'Task',
      projectId: 'p1',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: [],
      created: Date.now(),
      subTaskIds: [],
      ...overrides,
    }) as TaskCopy;

  // Minimal CdkDragDrop-shaped event — drop() only reads these fields.
  const mkDropEvent = (opts: {
    panelCfg: BoardPanelCfg;
    task: TaskCopy;
    previousContainerId?: string;
    containerId?: string;
    previousIndex?: number;
    currentIndex?: number;
    sourceTasks?: TaskCopy[];
  }): any => ({
    container: {
      id: opts.containerId ?? 'target',
      data: opts.panelCfg,
    },
    previousContainer: {
      id: opts.previousContainerId ?? 'source',
      data: opts.sourceTasks ?? [opts.task],
    },
    item: { data: opts.task },
    previousIndex: opts.previousIndex ?? 0,
    currentIndex: opts.currentIndex ?? 0,
  });

  const setup = async (tasks: TaskCopy[]): Promise<void> => {
    actions$ = new ReplaySubject(1);
    dispatchSpy = jasmine.createSpy('dispatch');
    updateTagsSpy = jasmine.createSpy('updateTags');

    const storeMock = {
      select: (selectorFn: any, props?: { id: string }) => {
        if (selectorFn === selectUnarchivedProjects)
          return of([{ id: 'p1', backlogTaskIds: [] }]);
        if (selectorFn === selectAllTasksInActiveProjects) return of(tasks);
        if (selectorFn === selectTaskById)
          return of(tasks.find((task) => task.id === props?.id));
        return of([]);
      },
      pipe: () => ({ toPromise: () => Promise.resolve(undefined) }),
      dispatch: dispatchSpy,
    };

    await TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        ...PLANNER_TASK_PROVIDERS,
        provideMockStore({}),
        provideMockActions(() => actions$),
        { provide: Store, useValue: storeMock },
        {
          provide: TaskService,
          useValue: {
            currentTaskId: signal(null),
            updateTags: updateTagsSpy,
          },
        },
        { provide: MatDialog, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
      ],
    })
      .overrideComponent(PlannerTaskComponent, {
        set: { template: '<div>Mock Task</div>', inputs: ['task'] },
      })
      .overrideComponent(AddTaskInlineComponent, {
        set: { template: '<div>Mock Add Task</div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPanelComponent);
    component = fixture.componentInstance;
  };

  it('returns early in sorted mode on intra-panel drop (no dispatch, no updateTags)', async () => {
    // Arrange — sortBy set → isManualOrder false; same container id on both sides
    await setup([mkTask({ id: 'a', tagIds: ['keep'] })]);
    const panelCfg = {
      id: 'p',
      title: 'P',
      taskIds: ['a'],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: 1,
      isParentTasksOnly: false,
      projectIds: [''],
      sortBy: 'title',
    } as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    // Act
    await component.drop(
      mkDropEvent({
        panelCfg,
        task: mkTask({ id: 'a', tagIds: ['keep'] }),
        previousContainerId: 'same',
        containerId: 'same',
      }),
    );

    // Assert
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(updateTagsSpy).not.toHaveBeenCalled();
  });

  it('reorders selected rows in this panel using one order action', async () => {
    await setup(['a', 'b', 'c', 'd'].map((id) => mkTask({ id })));
    fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
    fixture.detectChanges();
    component.multiSelect.toggle('b');
    component.multiSelect.toggle('c');
    component.reorder('b', 'down');
    expect(dispatchSpy).toHaveBeenCalledOnceWith(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: 'p',
        taskIds: ['a', 'd', 'b', 'c'],
      }),
    );
    expect(updateTagsSpy).not.toHaveBeenCalled();
  });

  for (const scenario of [
    { selected: ['a', 'b'], dragged: 'a', index: 2, expected: ['c', 'a', 'b', 'd', 'e'] },
    { selected: ['d', 'e'], dragged: 'e', index: 1, expected: ['a', 'd', 'e', 'b', 'c'] },
    { selected: ['b'], dragged: 'b', index: 3, expected: ['a', 'c', 'd', 'b', 'e'] },
    { selected: ['a', 'b'], dragged: 'a', index: 0, expected: ['a', 'b', 'c', 'd', 'e'] },
  ]) {
    it(`drops ${scenario.selected.join(',')} at the marker for row ${scenario.index}`, async () => {
      const tasks = ['a', 'b', 'c', 'd', 'e'].map((id) => mkTask({ id }));
      await setup(tasks);
      fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
      fixture.detectChanges();
      scenario.selected.forEach((id) => component.multiSelect.toggle(id));

      await component.drop(
        mkDropEvent({
          panelCfg: component.panelCfg(),
          task: tasks.find((task) => task.id === scenario.dragged)!,
          sourceTasks: tasks,
          previousContainerId: 'same',
          containerId: 'same',
          currentIndex: scenario.index,
        }),
      );

      expect(dispatchSpy).toHaveBeenCalledOnceWith(
        BoardsActions.updatePanelCfgTaskIds({
          panelId: 'p',
          taskIds: scenario.expected,
        }),
      );
    });
  }

  it('accounts for selected rows already above a drop marker in another panel', async () => {
    const tasks = ['a', 'b', 'c', 'd'].map((id) => mkTask({ id }));
    await setup(tasks);
    fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
    fixture.detectChanges();
    component.multiSelect.toggle('a');
    component.multiSelect.toggle('b');

    await component.drop(
      mkDropEvent({
        panelCfg: component.panelCfg(),
        task: tasks[0],
        sourceTasks: tasks.slice(0, 2),
        currentIndex: 3,
      }),
    );

    expect(dispatchSpy).toHaveBeenCalledOnceWith(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: 'p',
        taskIds: ['c', 'a', 'b', 'd'],
      }),
    );
  });

  it('does not keyboard-reorder a sorted panel', async () => {
    await setup(['a', 'b'].map((id) => mkTask({ id })));
    fixture.componentRef.setInput('panelCfg', {
      ...DEFAULT_PANEL_CFG,
      id: 'p',
      sortBy: 'title',
    });
    fixture.detectChanges();
    component.reorder('b', 'up');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('does not move or reorder a selection spanning panels', async () => {
    await setup(['a', 'b', 'c'].map((id) => mkTask({ id })));
    fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
    fixture.detectChanges();
    component.multiSelect.toggle('a');
    component.multiSelect.toggle('other-panel-task');
    const adjacentSpy = spyOn(component.adjacentPanel, 'emit');

    component.moveToAdjacent('a', 1);
    component.reorder('a', 'down');
    component.reorder('a', 'up');
    await component.drop(
      mkDropEvent({
        panelCfg: component.panelCfg(),
        task: mkTask({ id: 'a' }),
        sourceTasks: component.tasks(),
      }),
    );

    expect(adjacentSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(updateTagsSpy).not.toHaveBeenCalled();
  });

  it('moves a single-panel selection in source order, including duplicate cards', async () => {
    await setup(['a', 'b', 'c'].map((id) => mkTask({ id })));
    fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
    fixture.detectChanges();
    component.multiSelect.toggle('c');
    component.multiSelect.toggle('a');
    const adjacentSpy = spyOn(component.adjacentPanel, 'emit');

    component.moveToAdjacent('a', 1);

    expect(adjacentSpy).toHaveBeenCalledOnceWith({
      direction: 1,
      rowIndex: 0,
      taskIds: ['a', 'c'],
      focusTaskId: 'a',
    });
    await component.drop(
      mkDropEvent({
        panelCfg: component.panelCfg(),
        task: mkTask({ id: 'a' }),
        sourceTasks: component.tasks(),
        currentIndex: 0,
      }),
    );
    expect(dispatchSpy).toHaveBeenCalledOnceWith(
      BoardsActions.updatePanelCfgTaskIds({ panelId: 'p', taskIds: ['a', 'c', 'b'] }),
    );
  });

  it('places duplicated incoming tasks once without reordering an unrelated target row', async () => {
    await setup(['a', 'b', 'c'].map((id) => mkTask({ id })));
    fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
    fixture.detectChanges();
    const reanchorSpy = spyOn(
      component.multiSelect,
      'reanchorAfterMove',
    ).and.callThrough();
    await component.moveTasks(['c', 'c'], 0);
    expect(reanchorSpy).toHaveBeenCalledOnceWith(['c'], component.rows());
    expect(dispatchSpy).toHaveBeenCalledOnceWith(
      BoardsActions.updatePanelCfgTaskIds({
        panelId: 'p',
        taskIds: ['c', 'a', 'b'],
      }),
    );
    expect(component.multiSelect.isBulkFeedbackSuppressed()).toBeFalse();
  });

  for (const direction of ['up', 'down'] as const) {
    it(`requests the adjacent vertical panel when moving ${direction} at the boundary`, async () => {
      await setup(['a', 'b', 'c'].map((id) => mkTask({ id })));
      fixture.componentRef.setInput('panelCfg', { ...DEFAULT_PANEL_CFG, id: 'p' });
      fixture.detectChanges();
      const focusTaskId = direction === 'up' ? 'a' : 'c';
      component.multiSelect.toggle(focusTaskId);
      component.multiSelect.toggle('b');
      const adjacentSpy = spyOn(component.adjacentPanel, 'emit');

      component.reorder(focusTaskId, direction);

      expect(adjacentSpy).toHaveBeenCalledOnceWith({
        direction,
        rowIndex: 0,
        taskIds: direction === 'up' ? ['a', 'b'] : ['b', 'c'],
        focusTaskId,
      });
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  }

  it('uses the same destination tags and completion rule for every selected task', async () => {
    const tasks = ['a', 'b'].map((id) => mkTask({ id }));
    await setup(tasks);
    fixture.componentRef.setInput('panelCfg', {
      ...DEFAULT_PANEL_CFG,
      id: 'p',
      includedTagIds: ['in-progress'],
      taskDoneState: 2,
    });
    fixture.detectChanges();
    await component.moveTasks(['a', 'b']);
    for (const task of tasks) {
      expect(updateTagsSpy).toHaveBeenCalledWith(task, ['in-progress']);
      expect(dispatchSpy).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: task.id, changes: { isDone: true } },
        }),
      );
    }
    expect(dispatchSpy.calls.mostRecent().args[0]).toEqual(
      BoardsActions.updatePanelCfgTaskIds({ panelId: 'p', taskIds: ['a', 'b'] }),
    );
  });

  it('asks for one schedule before mutations and cancels the whole placement', async () => {
    await setup(['a', 'b'].map((id) => mkTask({ id })));
    fixture.componentRef.setInput('panelCfg', {
      ...DEFAULT_PANEL_CFG,
      id: 'p',
      includedTagIds: ['required'],
      scheduledState: 2,
    });
    fixture.detectChanges();
    const open = jasmine
      .createSpy('open')
      .and.returnValue({ afterClosed: () => of(undefined) });
    TestBed.inject(MatDialog).open = open;
    expect(await component.moveTasks(['a', 'b'])).toBeFalse();
    expect(open).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(updateTagsSpy).not.toHaveBeenCalled();
    expect(component.isMoving()).toBeFalse();
  });

  it('cross-panel drop with AND-excluded strips only the FIRST excluded and adds first missing included', async () => {
    // Arrange — target panel: includes 'need' (any), excludes ['x','y'] (all)
    const task = mkTask({ id: 't1', tagIds: ['x', 'y', 'keep'] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: ['need'],
      includedTagsMatch: 'any',
      excludedTagIds: ['x', 'y'],
      excludedTagsMatch: 'all',
      taskDoneState: 1,
      scheduledState: 1,
      isParentTasksOnly: false,
      projectIds: [''],
    } as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    // Act
    await component.drop(mkDropEvent({ panelCfg, task }));

    // Assert — only 'x' stripped (first excluded), 'need' appended
    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    const [taskArg, tagsArg] = updateTagsSpy.calls.mostRecent().args;
    expect(taskArg).toBe(task);
    expect(tagsArg).toEqual(['y', 'keep', 'need']);
  });

  it('cross-panel drop with OR-included and no exclusion adds the first required tag', async () => {
    // Arrange — target panel: includes ['need'] in 'any' mode, no exclusions
    const task = mkTask({ id: 't1', tagIds: ['other'] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: ['need'],
      includedTagsMatch: 'any',
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: 1,
      isParentTasksOnly: false,
      projectIds: [''],
    } as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    // Act
    await component.drop(mkDropEvent({ panelCfg, task }));

    // Assert — 'need' appended, 'other' preserved
    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    const [taskArg, tagsArg] = updateTagsSpy.calls.mostRecent().args;
    expect(taskArg).toBe(task);
    expect(tagsArg).toEqual(['other', 'need']);
  });

  // TODAY_TAG is selectable in the board tag picker (isShowMyDayTag), but it is
  // virtual — writing it to task.tagIds violates ARCHITECTURE-DECISIONS #2 and
  // syncs the corruption to every device.
  it('cross-panel drop never writes the virtual TODAY_TAG into the task', async () => {
    // Arrange
    const task = mkTask({ id: 't1', tagIds: ['other'] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [TODAY_TAG.id, 'need'],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: 1,
      isParentTasksOnly: false,
      projectIds: [''],
    } as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    // Act
    await component.drop(mkDropEvent({ panelCfg, task }));

    // Assert — only the real required tag is applied
    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    const [, tagsArg] = updateTagsSpy.calls.mostRecent().args;
    expect(tagsArg).toEqual(['other', 'need']);
  });

  // The AND-exclude list contains My Day, which `doesTaskMatchPanel` can never
  // see on a task — so that exclusion is already inert and no real tag ('x'/'y')
  // may be stripped to satisfy it. Only the legacy TODAY_TAG on the task itself
  // and the missing required tag are rewritten.
  it('adds an existing task by rewriting real tags without updating board order', async () => {
    const task = mkTask({
      id: 't1',
      tagIds: [TODAY_TAG.id, 'x', 'y', 'keep'],
    });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [TODAY_TAG.id, 'need'],
      includedTagsMatch: 'any',
      excludedTagIds: [TODAY_TAG.id, 'x', 'y'],
      excludedTagsMatch: 'all',
      taskDoneState: 1,
      scheduledState: 3,
      isParentTasksOnly: false,
      projectIds: [''],
    } as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.afterTaskAdd({
      taskId: task.id,
      isAddToBottom: false,
      isNewTask: false,
    });

    expect(updateTagsSpy).toHaveBeenCalledOnceWith(task, ['x', 'y', 'keep', 'need']);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('never writes the virtual TODAY_TAG into a task when the column requires My Day', async () => {
    const task = mkTask({ id: 't1', tagIds: ['keep'] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [TODAY_TAG.id, 'need'],
      includedTagsMatch: 'all',
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: 3,
      isParentTasksOnly: false,
      projectIds: [''],
    } as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.afterTaskAdd({
      taskId: task.id,
      isAddToBottom: false,
      isNewTask: false,
    });

    expect(updateTagsSpy).toHaveBeenCalledOnceWith(task, ['keep', 'need']);
  });
});

/**
 * `addButton()` feeds focus recovery and `onAddButtonKeydown`, which turns
 * ArrowLeft/Right into a jump to the neighbouring panel. Matching any
 * `add-task-inline button` meant that once the inline form was expanded the
 * first match became a button inside `<add-task-bar>` — so arrow keys typed
 * while adding a task jumped panels. Only the collapsed add button is marked.
 */
describe('BoardPanelComponent - add button lookup', () => {
  const setupWithAddTaskTemplate = async (
    template: string,
  ): Promise<BoardPanelComponent> => {
    await TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        ...PLANNER_TASK_PROVIDERS,
        provideMockStore({}),
        provideMockActions(() => new ReplaySubject(1)),
        {
          provide: Store,
          useValue: { select: () => of([]), dispatch: jasmine.createSpy('dispatch') },
        },
        { provide: TaskService, useValue: { currentTaskId: signal(null) } },
        { provide: MatDialog, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
      ],
    })
      .overrideComponent(PlannerTaskComponent, {
        set: { template: '<div>Mock Task</div>', inputs: ['task'] },
      })
      .overrideComponent(AddTaskInlineComponent, { set: { template } })
      .compileComponents();

    const fixture = TestBed.createComponent(BoardPanelComponent);
    fixture.componentRef.setInput('panelCfg', {
      ...DEFAULT_PANEL_CFG,
      id: 'panel',
      taskIds: [],
    } as BoardPanelCfg);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  it('finds the collapsed add button', async () => {
    const component = await setupWithAddTaskTemplate(
      '<div><button data-add-task-btn>Add</button></div>',
    );
    expect(component.addButton()).not.toBeNull();
  });

  // The add-task bar that replaces the collapsed button carries its own
  // buttons; an unmarked one must not be mistaken for the add button.
  it('finds nothing while the add-task bar is open', async () => {
    const component = await setupWithAddTaskTemplate(
      '<div class="add-task-bar-stub"><button>Some bar control</button></div>',
    );
    expect(component.addButton()).toBeNull();
  });
});

describe('BoardPanelComponent - date and deadline filters', () => {
  const TODAY = '2026-03-18'; // a Wednesday
  let component: BoardPanelComponent;
  let fixture: ComponentFixture<BoardPanelComponent>;
  let dispatchSpy: jasmine.Spy;
  let dialogOpenSpy: jasmine.Spy;
  let snackOpenSpy: jasmine.Spy;
  let bulk: { scheduleFor: jasmine.Spy; setDeadlineFor: jasmine.Spy };
  let firstDayOfWeek: number;

  const mkTask = (overrides: Partial<TaskCopy>): TaskCopy =>
    ({
      id: overrides.id || 't',
      title: 'Task',
      projectId: 'p1',
      timeSpentOnDay: {},
      attachments: [],
      timeEstimate: 0,
      timeSpent: 0,
      isDone: false,
      tagIds: [],
      created: new Date(2026, 2, 1).getTime(),
      subTaskIds: [],
      ...overrides,
    }) as TaskCopy;

  const panel = (cfg: Partial<BoardPanelCfg>): BoardPanelCfg => ({
    ...DEFAULT_PANEL_CFG,
    id: 'p',
    ...cfg,
  });

  const setup = async (tasks: TaskCopy[], cfg: Partial<BoardPanelCfg>): Promise<void> => {
    dispatchSpy = jasmine.createSpy('dispatch');
    dialogOpenSpy = jasmine.createSpy('open');
    snackOpenSpy = jasmine.createSpy('open');
    bulk = {
      scheduleFor: jasmine.createSpy('scheduleFor').and.resolveTo(),
      setDeadlineFor: jasmine.createSpy('setDeadlineFor').and.resolveTo(),
    };
    const storeMock = {
      select: (selectorFn: unknown, props?: { id: string }) => {
        if (selectorFn === selectUnarchivedProjects)
          return of([{ id: 'p1', backlogTaskIds: [] }]);
        if (selectorFn === selectAllTasksInActiveProjects) return of(tasks);
        if (selectorFn === selectTaskById)
          return of(tasks.find((task) => task.id === props?.id));
        if (selectorFn === selectStartOfNextDayDiffMs) return of(0);
        return of([]);
      },
      pipe: () => ({ toPromise: () => Promise.resolve(undefined) }),
      dispatch: dispatchSpy,
    };

    await TestBed.configureTestingModule({
      teardown: { destroyAfterEach: true },
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        ...PLANNER_TASK_PROVIDERS,
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: () => null,
            localization: () => ({ firstDayOfWeek }),
            appFeatures: () => ({ isTimeTrackingEnabled: false }),
          },
        },
        {
          provide: DateService,
          useValue: { todayStr: () => TODAY, getStartOfNextDayDiffMs: () => 0 },
        },
        {
          provide: GlobalTrackingIntervalService,
          useFactory: () => ({
            todayDateStr: signal(TODAY),
            clockTimestamp: signal(new Date(2026, 2, 18, 12).getTime()),
          }),
        },
        provideMockStore({}),
        provideMockActions(() => new ReplaySubject(1)),
        { provide: Store, useValue: storeMock },
        {
          provide: TaskService,
          useValue: {
            currentTaskId: signal(null),
            updateTags: jasmine.createSpy('updateTags'),
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
        { provide: SnackService, useValue: { open: snackOpenSpy } },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
        { provide: TaskBulkActionService, useValue: bulk },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
      ],
    })
      .overrideComponent(PlannerTaskComponent, {
        set: { template: '<div>Mock Task</div>', inputs: ['task'] },
      })
      .overrideComponent(AddTaskInlineComponent, {
        set: { template: '<div>Mock Add Task</div>' },
      })
      .compileComponents();

    fixture = TestBed.createComponent(BoardPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('panelCfg', panel(cfg));
    fixture.detectChanges();
  };

  const shownIds = (): string[] => component.tasks().map((task) => task.id);

  const dispatched = (type: string): unknown[] =>
    dispatchSpy.calls
      .allArgs()
      .map(([action]) => action)
      .filter((action) => action.type === type);

  beforeEach(() => {
    firstDayOfWeek = 1;
  });

  describe('filtering', () => {
    it('shows only tasks planned for today when scheduled timeframe is Today', async () => {
      await setup(
        [
          mkTask({ id: 'today', dueDay: TODAY }),
          mkTask({ id: 'timed', dueWithTime: new Date(2026, 2, 18, 15).getTime() }),
          mkTask({ id: 'tomorrow', dueDay: '2026-03-19' }),
          mkTask({ id: 'none' }),
        ],
        {
          scheduledState: BoardPanelCfgScheduledState.Scheduled,
          scheduledTimeframe: { type: 'today' },
        },
      );
      expect(shownIds()).toEqual(['today', 'timed']);
    });

    it('shows only deadline tasks in the next 7 days', async () => {
      await setup(
        [
          mkTask({ id: 'in', deadlineDay: '2026-03-24' }),
          mkTask({ id: 'out', deadlineDay: '2026-03-25' }),
          mkTask({ id: 'none' }),
        ],
        {
          deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
          deadlineTimeframe: { type: 'next7Days' },
        },
      );
      expect(shownIds()).toEqual(['in']);
    });

    it('shows only tasks without a deadline for NoDeadline', async () => {
      await setup(
        [
          mkTask({ id: 'day', deadlineDay: TODAY }),
          mkTask({ id: 'timed', deadlineWithTime: new Date(2026, 2, 18, 9).getTime() }),
          mkTask({ id: 'none' }),
        ],
        { deadlineState: BoardPanelCfgDeadlineState.NoDeadline },
      );
      expect(shownIds()).toEqual(['none']);
    });

    // Today is Wednesday 2026-03-18. Monday-start: next week is Mar 23–29;
    // Sunday-start: Mar 22–28.
    it('derives next week from the first day of week setting', async () => {
      const tasks = [
        mkTask({ id: 'sun22', dueDay: '2026-03-22' }),
        mkTask({ id: 'mon23', dueDay: '2026-03-23' }),
        mkTask({ id: 'sun29', dueDay: '2026-03-29' }),
      ];
      const cfg = {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
        scheduledTimeframe: { type: 'nextWeek' as const },
      };

      firstDayOfWeek = 1;
      await setup(tasks, cfg);
      expect(shownIds()).withContext('Monday start').toEqual(['mon23', 'sun29']);

      TestBed.resetTestingModule();
      firstDayOfWeek = 0;
      await setup(tasks, cfg);
      expect(shownIds()).withContext('Sunday start').toEqual(['sun22', 'mon23']);
    });
  });

  describe('moving tasks in', () => {
    it('replans a task to the nearest day of a scheduled timeframe', async () => {
      const task = mkTask({ id: 'a', dueDay: '2026-04-30' });
      await setup([task], {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
        scheduledTimeframe: { type: 'next7Days' },
      });

      expect(await component.moveTasks(['a'])).toBeTrue();

      expect(dialogOpenSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({ task, day: '2026-03-24' }),
      );
      expect(snackOpenSpy).toHaveBeenCalledTimes(1);
    });

    it('plans an unscheduled task into a timeframe panel without asking', async () => {
      const task = mkTask({ id: 'a' });
      await setup([task], {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
        scheduledTimeframe: { type: 'tomorrow' },
      });

      await component.moveTasks(['a']);

      expect(dialogOpenSpy).not.toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith(
        PlannerActions.planTaskForDay({ task, day: '2026-03-19' }),
      );
    });

    it('leaves a task alone that already fits the timeframe', async () => {
      await setup([mkTask({ id: 'a', dueDay: '2026-03-20' })], {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
        scheduledTimeframe: { type: 'next7Days' },
      });

      await component.moveTasks(['a']);

      expect(dispatched(PlannerActions.planTaskForDay.type)).toEqual([]);
      expect(snackOpenSpy).not.toHaveBeenCalled();
    });

    it('does not dispatch for an over-limit day count from a synced config', async () => {
      await setup([mkTask({ id: 'a', dueDay: TODAY })], {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
        scheduledTimeframe: { type: 'atLeastNDaysFuture', days: 1e9 },
      });

      expect(shownIds()).toEqual([]);
      await component.moveTasks(['a']);

      expect(dispatched(PlannerActions.planTaskForDay.type)).toEqual([]);
    });

    it('opens one schedule dialog for a scheduled panel without timeframe', async () => {
      await setup([mkTask({ id: 'a' })], {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
      });
      dialogOpenSpy.and.returnValue({ afterClosed: () => of(undefined) });

      expect(await component.moveTasks(['a'])).toBeFalse();

      expect(dialogOpenSpy).toHaveBeenCalledOnceWith(DialogScheduleTaskComponent, {
        data: { isSelectDueOnly: true },
      });
    });

    it('moves a deadline to the nearest day of a deadline timeframe', async () => {
      await setup([mkTask({ id: 'a', deadlineDay: '2026-05-01' })], {
        deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
        deadlineTimeframe: { type: 'customRange', customEnd: '2026-03-31' },
      });

      await component.moveTasks(['a']);

      expect(dispatched(TaskSharedActions.setDeadline.type)).toEqual([
        TaskSharedActions.setDeadline({
          taskId: 'a',
          deadlineDay: '2026-03-31',
          isSkipSnack: true,
        }),
      ]);
    });

    it('also plans the task for today when its deadline becomes today', async () => {
      await setup([mkTask({ id: 'a', deadlineDay: '2026-04-01' })], {
        deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
        deadlineTimeframe: { type: 'today' },
      });

      await component.moveTasks(['a']);

      const [action] = dispatched(TaskSharedActions.setDeadline.type) as {
        deadlineDay: string;
        autoPlanToday?: string;
      }[];
      expect(action.deadlineDay).toBe(TODAY);
      expect(action.autoPlanToday).toBe(TODAY);
    });

    it('asks once for a deadline and sets it for every task without one', async () => {
      const pick = { date: new Date(2026, 3, 1) };
      await setup([mkTask({ id: 'a' }), mkTask({ id: 'b', deadlineDay: '2026-03-20' })], {
        deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      });
      dialogOpenSpy.and.returnValue({ afterClosed: () => of(pick) });

      expect(await component.moveTasks(['a', 'b'])).toBeTrue();

      expect(dialogOpenSpy).toHaveBeenCalledOnceWith(DialogDeadlineComponent, {
        autoFocus: false,
        data: { isSelectDeadlineOnly: true },
      });
      expect(bulk.setDeadlineFor).toHaveBeenCalledOnceWith(pick, [
        jasmine.objectContaining({ id: 'a' }),
      ]);
    });

    it('cancels the whole placement when the deadline dialog is dismissed', async () => {
      await setup([mkTask({ id: 'a' })], {
        deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      });
      dialogOpenSpy.and.returnValue({ afterClosed: () => of(undefined) });

      expect(await component.moveTasks(['a'])).toBeFalse();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('removes the deadline silently when moving into a NoDeadline panel', async () => {
      await setup([mkTask({ id: 'a', deadlineDay: TODAY }), mkTask({ id: 'b' })], {
        deadlineState: BoardPanelCfgDeadlineState.NoDeadline,
      });

      await component.moveTasks(['a', 'b']);

      expect(dispatched(TaskSharedActions.removeDeadline.type)).toEqual([
        TaskSharedActions.removeDeadline({ taskId: 'a', isSkipSnack: true }),
      ]);
    });

    it('shows no per-task snack when several tasks are adjusted at once', async () => {
      await setup([mkTask({ id: 'a', dueDay: '2026-05-01' }), mkTask({ id: 'b' })], {
        scheduledState: BoardPanelCfgScheduledState.Scheduled,
        scheduledTimeframe: { type: 'today' },
      });

      await component.moveTasks(['a', 'b']);

      expect(dispatched(PlannerActions.planTaskForDay.type).length).toBe(2);
      expect(snackOpenSpy).not.toHaveBeenCalled();
    });
  });
});
