import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { signal } from '@angular/core';
import { GlobalConfigService } from '../config/global-config.service';
import { GlobalConfigState } from '../config/global-config.model';
import { of } from 'rxjs';
import { IssueService } from '../issue/issue.service';
import { LocalRestApiFeatureBridgeService } from './local-rest-api-feature-bridge.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { addSubTask } from './store/task.actions';
import { Task, TaskReminderOptionId, TaskWithSubTasks } from './task.model';
import { TaskMoveToProjectService } from './task-move-to-project.service';
import { TaskService } from './task.service';

describe('LocalRestApiFeatureBridgeService', () => {
  let service: LocalRestApiFeatureBridgeService;
  let taskServiceMock: jasmine.SpyObj<TaskService>;
  let issueServiceMock: jasmine.SpyObj<IssueService>;
  let taskMoveToProjectServiceMock: jasmine.SpyObj<TaskMoveToProjectService>;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    taskServiceMock = jasmine.createSpyObj<TaskService>('TaskService', [
      'createNewTaskWithDefaults',
      'addTimeSpentAndSync',
      'getByIdWithSubTaskData$',
      'update',
    ]);
    issueServiceMock = jasmine.createSpyObj<IssueService>('IssueService', ['issueLink']);
    taskMoveToProjectServiceMock = jasmine.createSpyObj<TaskMoveToProjectService>(
      'TaskMoveToProjectService',
      ['moveToProject'],
    );
    taskMoveToProjectServiceMock.moveToProject.and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        LocalRestApiFeatureBridgeService,
        { provide: TaskService, useValue: taskServiceMock },
        { provide: IssueService, useValue: issueServiceMock },
        { provide: TaskMoveToProjectService, useValue: taskMoveToProjectServiceMock },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal({
              reminder: { defaultTaskRemindOption: TaskReminderOptionId.m10 },
            } as GlobalConfigState),
          },
        },
        provideMockStore(),
      ],
    });

    service = TestBed.inject(LocalRestApiFeatureBridgeService);
    dispatchSpy = spyOn(TestBed.inject(MockStore), 'dispatch');
  });

  it('should delegate issueLink to the issue service', async () => {
    issueServiceMock.issueLink.and.returnValue(
      Promise.resolve('https://github.com/o/r/issues/42'),
    );

    await expectAsync(service.issueLink('GITHUB', '42', 'provider-1')).toBeResolvedTo(
      'https://github.com/o/r/issues/42',
    );
    expect(issueServiceMock.issueLink).toHaveBeenCalledOnceWith(
      'GITHUB',
      '42',
      'provider-1',
    );
  });

  it('should add a subtask that skips short syntax', () => {
    taskServiceMock.createNewTaskWithDefaults.and.returnValue({
      id: 'literal-sub',
      title: 'Child #x',
    } as Task);

    const id = service.addLiteralSubTask('parent-1', { title: 'Child #x' });

    expect(id).toBe('literal-sub');
    // Same arguments TaskService.addSubTaskTo passes — incl. the dueDay key,
    // whose presence stops a Today context from giving the subtask a due date.
    const factoryArgs = taskServiceMock.createNewTaskWithDefaults.calls.mostRecent()
      .args[0] as { title: string; additional: Record<string, unknown> };
    expect(factoryArgs.title).toBe('Child #x');
    expect('dueDay' in factoryArgs.additional).toBe(true);
    expect(factoryArgs.additional.title).toBe('Child #x');
    const action = dispatchSpy.calls.mostRecent().args[0];
    expect(action.type).toBe(addSubTask.type);
    expect(action.task.id).toBe('literal-sub');
    expect(action.parentId).toBe('parent-1');
    expect(action.isIgnoreShortSyntax).toBe(true);
  });

  it('should add time spent on a given day through addTimeSpentAndSync', () => {
    const task = { id: 'task-1' } as Task;

    service.addTimeSpentOnDay(task, 3600000, '2026-05-10');

    expect(taskServiceMock.addTimeSpentAndSync).toHaveBeenCalledOnceWith(
      task,
      3600000,
      '2026-05-10',
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('should move a task with its subtasks without asking', async () => {
    const task = { id: 'task-1', subTasks: [] } as unknown as TaskWithSubTasks;
    taskServiceMock.getByIdWithSubTaskData$.and.returnValue(of(task));

    await service.moveTaskToProject('task-1', 'project-2');

    expect(taskServiceMock.getByIdWithSubTaskData$).toHaveBeenCalledOnceWith('task-1');
    expect(taskMoveToProjectServiceMock.moveToProject).toHaveBeenCalledOnceWith(
      task,
      'project-2',
      { isSkipConfirm: true },
    );
  });

  it('should not move a task that no longer exists', async () => {
    taskServiceMock.getByIdWithSubTaskData$.and.returnValue(of(undefined));

    await service.moveTaskToProject('task-1', 'project-2');

    expect(taskMoveToProjectServiceMock.moveToProject).not.toHaveBeenCalled();
  });

  describe('updateTaskWithDueTime', () => {
    const dueWithTime = 1_778_590_800_000;
    const tenMinutes = 10 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;

    it('should clear the reminder when dueWithTime is cleared', () => {
      const task = { id: 'task-1', dueWithTime, remindAt: dueWithTime } as Task;

      service.updateTaskWithDueTime(task, { dueWithTime: undefined });

      expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
        dueWithTime: undefined,
      });
      expect(dispatchSpy).toHaveBeenCalledOnceWith(
        TaskSharedActions.dismissReminderOnly({ id: 'task-1', isSkipSnack: true }),
      );
    });

    it('should move the reminder with dueWithTime and keep its offset', () => {
      const task = {
        id: 'task-1',
        dueWithTime,
        remindAt: dueWithTime - tenMinutes,
      } as Task;
      const movedDueWithTime = dueWithTime + oneDay;

      service.updateTaskWithDueTime(task, { dueWithTime: movedDueWithTime });

      expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
        dueWithTime: movedDueWithTime,
        remindAt: movedDueWithTime - tenMinutes,
      });
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should add the default reminder when a task gets a time for the first time', () => {
      const task = { id: 'task-1' } as Task;

      service.updateTaskWithDueTime(task, { dueWithTime, title: 'Call' });

      expect(taskServiceMock.update).toHaveBeenCalledOnceWith('task-1', {
        dueWithTime,
        title: 'Call',
        remindAt: dueWithTime - tenMinutes,
      });
      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });
});
