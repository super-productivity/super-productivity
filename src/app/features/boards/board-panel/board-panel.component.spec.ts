import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardPanelComponent } from './board-panel.component';
import {
  BoardPanelCfg,
  BoardPanelCfgTaskTypeFilter,
  BoardPanelCfgDeadlineState,
  BoardPanelCfgScheduledState,
} from '../boards.model';
import { TaskCopy } from '../../tasks/task.model';
import { DateService } from '../../../core/date/date.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
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
import { PlannerActions } from '../../planner/store/planner.actions';
import { DialogDeadlineComponent } from '../../tasks/dialog-deadline/dialog-deadline.component';
import { getDeadlineAutoPlanFields } from '../../tasks/util/get-deadline-auto-plan-fields';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { ProjectService } from '../../project/project.service';
import { signal } from '@angular/core';

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
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
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
          template: '<div>Mock Task</div>',
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
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
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
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
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

  describe('scheduledTimeframe and deadlineState filters', () => {
    const mockTodayStr = '2026-06-14';
    const mockStartOfNextDayDiffMs = 0;

    let mockDateService: any;

    const setupWithMockDateService = async (tasks: TaskCopy[]): Promise<void> => {
      actions$ = new ReplaySubject(1);
      mockDateService = {
        getStartOfNextDayDiffMs: () => mockStartOfNextDayDiffMs,
        todayStr: (d?: Date | number) => (d ? getDbDateStr(d) : mockTodayStr),
        getLogicalTomorrowMs: () => new Date('2026-06-15T12:00:00Z').getTime(),
      };

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
        imports: [
          BoardPanelComponent,
          TranslateModule.forRoot({
            loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
          }),
        ],
        providers: [
          provideMockStore({}),
          provideMockActions(() => actions$),
          { provide: Store, useValue: storeMock },
          { provide: TaskService, useValue: { currentTaskId: signal(null) } },
          { provide: MatDialog, useValue: {} },
          { provide: WorkContextService, useValue: {} },
          { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
          { provide: DateService, useValue: mockDateService },
          { provide: DateTimeFormatService, useValue: { currentLocale: () => 'de' } },
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

    it('filters scheduled tasks by TODAY timeframe', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-today', dueDay: '2026-06-14' }),
        mkTask({ id: 't-tomorrow', dueDay: '2026-06-15' }),
        mkTask({ id: 't-unscheduled' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 2, // Scheduled
        scheduledTimeframe: 'TODAY',
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['t-today']);
    });

    it('filters scheduled tasks by TOMORROW timeframe', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-today', dueDay: '2026-06-14' }),
        mkTask({ id: 't-tomorrow', dueDay: '2026-06-15' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 2,
        scheduledTimeframe: 'TOMORROW',
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['t-tomorrow']);
    });

    it('filters scheduled tasks by NEXT_WEEK timeframe', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-today', dueDay: '2026-06-14' }),
        mkTask({ id: 't-in-week', dueDay: '2026-06-20' }),
        mkTask({ id: 't-out-of-week', dueDay: '2026-06-22' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 2,
        scheduledTimeframe: 'NEXT_WEEK',
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      const ids = component.tasks().map((t) => t.id);
      expect(ids).toContain('t-today');
      expect(ids).toContain('t-in-week');
      expect(ids).not.toContain('t-out-of-week');
    });

    it('filters scheduled tasks by NEXT_DAYS timeframe', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-today', dueDay: '2026-06-14' }),
        mkTask({ id: 't-in-range', dueDay: '2026-06-17' }),
        mkTask({ id: 't-out-of-range', dueDay: '2026-06-19' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 2,
        scheduledTimeframe: 'NEXT_DAYS',
        scheduledDaysVal: 4,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      const ids = component.tasks().map((t) => t.id);
      expect(ids).toContain('t-today');
      expect(ids).toContain('t-in-range');
      expect(ids).not.toContain('t-out-of-range');
    });

    it('filters scheduled tasks by AT_LEAST_DAYS_FUTURE timeframe', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-today', dueDay: '2026-06-14' }),
        mkTask({ id: 't-before', dueDay: '2026-06-17' }),
        mkTask({ id: 't-at-least', dueDay: '2026-06-19' }),
        mkTask({ id: 't-future', dueDay: '2026-07-01' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 2,
        scheduledTimeframe: 'AT_LEAST_DAYS_FUTURE',
        scheduledDaysVal: 5,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      const ids = component.tasks().map((t) => t.id);
      expect(ids).not.toContain('t-today');
      expect(ids).not.toContain('t-before');
      expect(ids).toContain('t-at-least');
      expect(ids).toContain('t-future');
    });

    it('filters scheduled tasks by CUSTOM_RANGE timeframe', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-before', dueDay: '2026-06-10' }),
        mkTask({ id: 't-in-range', dueDay: '2026-06-15' }),
        mkTask({ id: 't-after', dueDay: '2026-06-20' }),
      ]);
      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 2,
        scheduledTimeframe: 'CUSTOM_RANGE',
        scheduledCustomStart: '2026-06-12',
        scheduledCustomEnd: '2026-06-17',
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['t-in-range']);
    });

    it('filters by HasDeadline and NoDeadline states', async () => {
      await setupWithMockDateService([
        mkTask({ id: 't-deadline', deadlineDay: '2026-06-14' }),
        mkTask({ id: 't-no-deadline' }),
      ]);

      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
        deadlineTimeframe: 'ALL',
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();
      expect(component.tasks().map((t) => t.id)).toEqual(['t-deadline']);

      fixture.componentRef.setInput('panelCfg', {
        id: 'p',
        title: 'P',
        taskIds: [],
        includedTagIds: [],
        excludedTagIds: [],
        taskDoneState: 1,
        scheduledState: 1,
        deadlineState: BoardPanelCfgDeadlineState.NoDeadline,
        isParentTasksOnly: false,
        projectIds: [''],
      } as BoardPanelCfg);
      fixture.detectChanges();
      expect(component.tasks().map((t) => t.id)).toEqual(['t-no-deadline']);
    });
  });
});

describe('BoardPanelComponent - drop()', () => {
  let component: BoardPanelComponent;
  let fixture: ComponentFixture<BoardPanelComponent>;
  let actions$: ReplaySubject<any>;
  let dispatchSpy: jasmine.Spy;
  let updateTagsSpy: jasmine.Spy;
  let dialogOpenSpy: jasmine.Spy;
  let mockDateService: any;
  const mockTodayStr = '2026-06-14';
  const mockStartOfNextDayDiffMs = 0;

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
  }): any => ({
    container: {
      id: opts.containerId ?? 'target',
      data: opts.panelCfg,
    },
    previousContainer: {
      id: opts.previousContainerId ?? 'source',
    },
    item: { data: opts.task },
    previousIndex: opts.previousIndex ?? 0,
    currentIndex: opts.currentIndex ?? 0,
  });

  const setup = async (tasks: TaskCopy[]): Promise<void> => {
    actions$ = new ReplaySubject(1);
    dispatchSpy = jasmine.createSpy('dispatch');
    updateTagsSpy = jasmine.createSpy('updateTags');
    dialogOpenSpy = jasmine.createSpy('open');

    mockDateService = {
      getStartOfNextDayDiffMs: () => mockStartOfNextDayDiffMs,
      todayStr: (d?: Date | number) => (d ? getDbDateStr(d) : mockTodayStr),
      getLogicalTomorrowMs: () => new Date('2026-06-15T12:00:00Z').getTime(),
    };

    const storeMock = {
      select: (selectorFn: any, props?: any) => {
        if (selectorFn === selectUnarchivedProjects)
          return of([{ id: 'p1', backlogTaskIds: [] }]);
        if (selectorFn === selectAllTasksInActiveProjects) return of(tasks);
        if (selectorFn === selectTaskById && props) {
          const t = tasks.find((x) => x.id === props.id);
          return of(t);
        }
        return of([]);
      },
      pipe: () => ({ toPromise: () => Promise.resolve(undefined) }),
      dispatch: dispatchSpy,
    };

    await TestBed.configureTestingModule({
      imports: [
        BoardPanelComponent,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
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
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
        { provide: WorkContextService, useValue: {} },
        { provide: ProjectService, useValue: { getProjectsWithoutId$: () => of([]) } },
        { provide: DateService, useValue: mockDateService },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'de' } },
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

  it('cross-panel drop with AND-excluded strips only the FIRST excluded and adds first missing included', async () => {
    // Arrange — target panel: includes 'need' (any), excludes ['x','y'] (all)
    await setup([]);
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

    const task = mkTask({ id: 't1', tagIds: ['x', 'y', 'keep'] });

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
    await setup([]);
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

    const task = mkTask({ id: 't1', tagIds: ['other'] });

    // Act
    await component.drop(mkDropEvent({ panelCfg, task }));

    // Assert — 'need' appended, 'other' preserved
    expect(updateTagsSpy).toHaveBeenCalledTimes(1);
    const [taskArg, tagsArg] = updateTagsSpy.calls.mostRecent().args;
    expect(taskArg).toBe(task);
    expect(tagsArg).toEqual(['other', 'need']);
  });

  it('cross-panel drop on scheduled TODAY panel replans task for today', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'TODAY',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-14',
      }),
    );
  });

  it('cross-panel drop on scheduled TOMORROW panel replans task for tomorrow', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'TOMORROW',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-15',
      }),
    );
  });

  it('cross-panel drop on scheduled NEXT_WEEK panel plans for today if not scheduled', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'NEXT_WEEK',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-14',
      }),
    );
  });

  it('cross-panel drop on scheduled NEXT_WEEK panel plans for closest bound if scheduled outside', async () => {
    const task = mkTask({ id: 't1', tagIds: [], dueDay: '2026-06-30' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'NEXT_WEEK',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-21', // today + 7 days
      }),
    );
  });

  it('cross-panel drop on scheduled AT_LEAST_DAYS_FUTURE panel plans for closest bound if scheduled outside', async () => {
    const task = mkTask({ id: 't1', tagIds: [], dueDay: '2026-06-17' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'AT_LEAST_DAYS_FUTURE',
      scheduledDaysVal: 5,
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-19', // today (14) + 5 days = 19
      }),
    );
  });

  it('cross-panel drop on scheduled CUSTOM_RANGE panel plans for closest date (before custom start)', async () => {
    const task = mkTask({ id: 't1', tagIds: [], dueDay: '2026-06-10' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'CUSTOM_RANGE',
      scheduledCustomStart: '2026-06-20',
      scheduledCustomEnd: '2026-06-25',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-20',
      }),
    );
  });

  it('cross-panel drop on scheduled CUSTOM_RANGE panel plans for closest date (after custom end)', async () => {
    const task = mkTask({ id: 't1', tagIds: [], dueDay: '2026-06-30' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'CUSTOM_RANGE',
      scheduledCustomStart: '2026-06-20',
      scheduledCustomEnd: '2026-06-25',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      PlannerActions.planTaskForDay({
        task,
        day: '2026-06-25',
      }),
    );
  });

  it('cross-panel drop on scheduled ALL panel opens scheduling dialog if not scheduled', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
      scheduledTimeframe: 'ALL',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dialogOpenSpy).toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: PlannerActions.planTaskForDay.type }),
    );
  });

  it('cross-panel drop on HasDeadline TODAY panel replans task deadline for today', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      deadlineTimeframe: 'TODAY',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.setDeadline({
        taskId: task.id,
        deadlineDay: '2026-06-14',
        ...getDeadlineAutoPlanFields(mockDateService, '2026-06-14'),
      }),
    );
  });

  it('cross-panel drop on HasDeadline TOMORROW panel replans task deadline for tomorrow', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      deadlineTimeframe: 'TOMORROW',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.setDeadline({
        taskId: task.id,
        deadlineDay: '2026-06-15',
        ...getDeadlineAutoPlanFields(mockDateService, '2026-06-15'),
      }),
    );
  });

  it('cross-panel drop on HasDeadline NEXT_WEEK panel plans deadline for today if no deadline', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      deadlineTimeframe: 'NEXT_WEEK',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.setDeadline({
        taskId: task.id,
        deadlineDay: '2026-06-14',
        ...getDeadlineAutoPlanFields(mockDateService, '2026-06-14'),
      }),
    );
  });

  it('cross-panel drop on HasDeadline NEXT_WEEK panel plans deadline for closest bound if deadline outside', async () => {
    const task = mkTask({ id: 't1', tagIds: [], deadlineDay: '2026-06-30' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      deadlineTimeframe: 'NEXT_WEEK',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.setDeadline({
        taskId: task.id,
        deadlineDay: '2026-06-21', // today + 7 days
        ...getDeadlineAutoPlanFields(mockDateService, '2026-06-21'),
      }),
    );
  });

  it('cross-panel drop on HasDeadline AT_LEAST_DAYS_FUTURE panel plans deadline for closest bound if deadline outside', async () => {
    const task = mkTask({ id: 't1', tagIds: [], deadlineDay: '2026-06-17' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      deadlineTimeframe: 'AT_LEAST_DAYS_FUTURE',
      deadlineDaysVal: 5,
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.setDeadline({
        taskId: task.id,
        deadlineDay: '2026-06-19', // today (14) + 5 days = 19
        ...getDeadlineAutoPlanFields(mockDateService, '2026-06-19'),
      }),
    );
  });

  it('cross-panel drop on HasDeadline ALL panel opens deadline dialog if no deadline', async () => {
    const task = mkTask({ id: 't1', tagIds: [] });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.HasDeadline,
      deadlineTimeframe: 'ALL',
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dialogOpenSpy).toHaveBeenCalledWith(
      DialogDeadlineComponent,
      jasmine.any(Object),
    );
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: TaskSharedActions.setDeadline.type }),
    );
  });

  it('cross-panel drop on NoDeadline panel removes deadline', async () => {
    const task = mkTask({ id: 't1', tagIds: [], deadlineDay: '2026-06-14' });
    await setup([task]);
    const panelCfg = {
      id: 'target',
      title: 'Target',
      taskIds: [],
      includedTagIds: [],
      excludedTagIds: [],
      taskDoneState: 1,
      deadlineState: BoardPanelCfgDeadlineState.NoDeadline,
      isParentTasksOnly: false,
      projectIds: [''],
    } as any as BoardPanelCfg;
    fixture.componentRef.setInput('panelCfg', panelCfg);
    fixture.detectChanges();

    await component.drop(mkDropEvent({ panelCfg, task }));

    expect(dispatchSpy).toHaveBeenCalledWith(
      TaskSharedActions.removeDeadline({
        taskId: task.id,
      }),
    );
  });
});
