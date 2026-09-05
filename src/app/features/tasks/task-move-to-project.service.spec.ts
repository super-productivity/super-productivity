import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { TaskMoveToProjectService } from './task-move-to-project.service';
import { TaskService } from './task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { ProjectService } from '../project/project.service';
import { DEFAULT_TASK, TaskWithSubTasks } from './task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';

describe('TaskMoveToProjectService', () => {
  let service: TaskMoveToProjectService;
  let taskService: jasmine.SpyObj<TaskService>;
  let repeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let dialogResult: boolean;

  const task = (overrides: Partial<TaskWithSubTasks> = {}): TaskWithSubTasks =>
    ({
      ...DEFAULT_TASK,
      id: 't1',
      title: 'Task',
      projectId: 'p1',
      subTasks: [],
      ...overrides,
    }) as TaskWithSubTasks;

  beforeEach(() => {
    dialogResult = true;
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'moveToProject',
      'getTasksWithSubTasksByRepeatCfgId$',
      'getArchiveTasksForRepeatCfgId',
      'updateArchiveTasks',
    ]);
    taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);
    taskService.updateArchiveTasks.and.resolveTo();
    repeatCfgService = jasmine.createSpyObj<TaskRepeatCfgService>(
      'TaskRepeatCfgService',
      ['getTaskRepeatCfgByIdAllowUndefined$', 'updateTaskRepeatCfg'],
    );

    TestBed.configureTestingModule({
      providers: [
        TaskMoveToProjectService,
        { provide: TaskService, useValue: taskService },
        { provide: TaskRepeatCfgService, useValue: repeatCfgService },
        {
          provide: ProjectService,
          useValue: { getByIdOnce$: () => of({ id: 'p2', title: 'P2' }) },
        },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(dialogResult) }) },
        },
      ],
    });
    service = TestBed.inject(TaskMoveToProjectService);
  });

  it('does nothing for the same project or for a subtask', async () => {
    expect(await service.moveToProject(task(), 'p1')).toBeFalse();
    expect(await service.moveToProject(task({ parentId: 'x' }), 'p2')).toBeFalse();
    expect(taskService.moveToProject).not.toHaveBeenCalled();
  });

  it('moves a plain task directly', async () => {
    const t = task();
    expect(await service.moveToProject(t, 'p2')).toBeTrue();
    expect(taskService.moveToProject).toHaveBeenCalledWith(t, 'p2');
  });

  it('falls back to a plain move when the repeat config is gone (#8715)', async () => {
    const t = task({ repeatCfgId: 'cfg' });
    repeatCfgService.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
      of(undefined as TaskRepeatCfg | undefined),
    );
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([t]));

    expect(await service.moveToProject(t, 'p2')).toBeTrue();
    expect(taskService.moveToProject).toHaveBeenCalledWith(t, 'p2');
    expect(repeatCfgService.updateTaskRepeatCfg).not.toHaveBeenCalled();
  });

  it('updates the config directly for a single live instance', async () => {
    const t = task({ repeatCfgId: 'cfg' });
    repeatCfgService.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
      of({ id: 'cfg' } as TaskRepeatCfg),
    );
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([t]));

    expect(await service.moveToProject(t, 'p2')).toBeTrue();
    expect(repeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledWith('cfg', {
      projectId: 'p2',
    });
    expect(taskService.moveToProject).toHaveBeenCalledWith(t, 'p2');
  });

  it('moves every instance after confirmation and skips on cancel', async () => {
    const t1 = task({ id: 'a', repeatCfgId: 'cfg' });
    const t2 = task({ id: 'b', repeatCfgId: 'cfg' });
    repeatCfgService.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
      of({ id: 'cfg' } as TaskRepeatCfg),
    );
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([t1, t2]));
    taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([
      { ...DEFAULT_TASK, id: 'arch', subTaskIds: ['arch-sub'] } as never,
    ]);

    expect(await service.moveToProject(t1, 'p2')).toBeTrue();
    expect(taskService.moveToProject).toHaveBeenCalledTimes(2);
    expect(taskService.updateArchiveTasks).toHaveBeenCalledWith([
      { id: 'arch', changes: { projectId: 'p2' } },
      { id: 'arch-sub', changes: { projectId: 'p2' } },
    ]);

    taskService.moveToProject.calls.reset();
    dialogResult = false;
    expect(await service.moveToProject(t1, 'p2')).toBeFalse();
    expect(taskService.moveToProject).not.toHaveBeenCalled();
  });
});
