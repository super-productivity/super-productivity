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
