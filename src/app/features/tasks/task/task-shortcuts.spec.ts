import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
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

describe('TaskComponent shortcut handling', () => {
  let fixture: import('@angular/core/testing').ComponentFixture<TaskComponent>;
  let component: TaskComponent;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;

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
      ],
      {
        currentTaskId: signal<string | null>(null),
        selectedTaskId: signal<string | null>(null),
        todayListSet: signal<Set<string>>(new Set<string>()),
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
            cfg: () => ({ keyboard: {}, tasks: {} }),
          }),
        },
        {
          provide: TaskAttachmentService,
          useValue: jasmine.createSpyObj('TaskAttachmentService', [
            'createFromDrop',
            'addAttachment',
          ]),
        },
        { provide: Store, useValue: jasmine.createSpyObj('Store', ['dispatch']) },
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
          useValue: jasmine.createSpyObj('DateService', ['isToday'], {
            isToday: () => false,
          }),
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
});
