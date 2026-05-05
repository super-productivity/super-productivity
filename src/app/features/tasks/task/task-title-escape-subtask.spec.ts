import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { DateService } from '../../../core/date/date.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { ProjectService } from '../../project/project.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { TaskAttachmentService } from '../task-attachment/task-attachment.service';
import { TaskFocusService } from '../task-focus.service';
import { DEFAULT_TASK, TaskWithSubTasks } from '../task.model';
import { TaskService } from '../task.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { TaskComponent } from './task.component';

describe('Task subtask Escape delete guard', () => {
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

  beforeEach(async () => {
    taskServiceSpy = jasmine.createSpyObj<TaskService>(
      'TaskService',
      [
        'update',
        'remove',
        'addSubTaskTo',
        'setSelectedId',
        'toggleSubTaskMode',
        'toggleDoneWithAnimation',
        'moveUp',
        'moveDown',
        'moveToTop',
        'moveToBottom',
        'setCurrentId',
        'pauseCurrent',
      ],
      {
        currentTaskId: signal<string | null>(null),
        selectedTaskId: signal<string | null>(null),
        todayListSet: signal<Set<string>>(new Set<string>()),
      },
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
});
