import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardPanelComponent } from './board-panel.component';
import { BoardPanelCfg, BoardPanelCfgTaskTypeFilter } from '../boards.model';
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
import { selectAllTasksWithoutHiddenProjects } from '../../tasks/store/task.selectors';
import { WorkContextService } from '../../work-context/work-context.service';
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
    projectId: undefined,
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
        } else if (selectorFn === selectAllTasksWithoutHiddenProjects) {
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
  const regularTaskId = 'regular-task';

  const mockPanelCfg: Partial<BoardPanelCfg> = {
    id: 'panel-1',
    title: 'Test Panel',
    taskIds: [],
    backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
    includedTagIds: [],
    excludedTagIds: [],
    isParentTasksOnly: false,
    projectId: undefined,
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
        } else if (selectorFn === selectAllTasksWithoutHiddenProjects) {
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

  it('should exclude backlog tasks from hidden projects when backlogState is NoBacklog', () => {
    fixture.componentRef.setInput('panelCfg', {
      ...mockPanelCfg,
      backlogState: BoardPanelCfgTaskTypeFilter.NoBacklog,
    } as BoardPanelCfg);
    fixture.detectChanges();

    const tasks = component.tasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(regularTaskId);
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
        if (selectorFn === selectAllTasksWithoutHiddenProjects) return of(tasks);
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
      } as BoardPanelCfg);
      fixture.detectChanges();

      expect(component.tasks().map((t) => t.id)).toEqual(['some']);
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

    const storeMock = {
      select: (selectorFn: any) => {
        if (selectorFn === selectUnarchivedProjects)
          return of([{ id: 'p1', backlogTaskIds: [] }]);
        if (selectorFn === selectAllTasksWithoutHiddenProjects) return of(tasks);
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
});
