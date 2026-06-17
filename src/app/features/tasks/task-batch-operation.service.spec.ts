import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { Update } from '@ngrx/entity';
import { TaskBatchOperationService } from './task-batch-operation.service';
import { TaskService } from './task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { ProjectService } from '../project/project.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from './task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';
import { Project } from '../project/project.model';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { T } from '../../t.const';

describe('TaskBatchOperationService', () => {
  let service: TaskBatchOperationService;
  let taskService: jasmine.SpyObj<TaskService>;
  let taskRepeatCfgService: jasmine.SpyObj<TaskRepeatCfgService>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let matDialog: jasmine.SpyObj<MatDialog>;

  const createTask = (id: string, overrides: Partial<Task> = {}): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    created: 1,
    projectId: 'project-a',
    ...overrides,
    subTasks: [],
  });

  const createRepeatCfg = (id: string): TaskRepeatCfg =>
    ({
      id,
      projectId: 'project-a',
    }) as TaskRepeatCfg;

  const targetProject = {
    id: 'project-b',
    title: 'Project B',
  } as Project;

  const dialogRef = <T>(value: T): MatDialogRef<unknown, T> =>
    ({ afterClosed: () => of(value) }) as unknown as MatDialogRef<unknown, T>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj('TaskService', [
      'moveToProject',
      'getTasksWithSubTasksByRepeatCfgId$',
      'getArchiveTasksForRepeatCfgId',
      'updateArchiveTasks',
    ]);
    taskRepeatCfgService = jasmine.createSpyObj('TaskRepeatCfgService', [
      'getTaskRepeatCfgById$',
      'updateTaskRepeatCfg',
    ]);
    projectService = jasmine.createSpyObj('ProjectService', ['getByIdOnce$']);
    matDialog = jasmine.createSpyObj('MatDialog', ['open']);

    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
    taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([]);
    taskService.updateArchiveTasks.and.resolveTo();
    taskRepeatCfgService.getTaskRepeatCfgById$.and.returnValue(
      of(createRepeatCfg('repeat-1')),
    );
    projectService.getByIdOnce$.and.returnValue(of(targetProject));

    TestBed.configureTestingModule({
      providers: [
        TaskBatchOperationService,
        { provide: TaskService, useValue: taskService },
        { provide: TaskRepeatCfgService, useValue: taskRepeatCfgService },
        { provide: ProjectService, useValue: projectService },
        { provide: MatDialog, useValue: matDialog },
      ],
    });

    service = TestBed.inject(TaskBatchOperationService);
  });

  it('returns false without moving when task is already in target project', async () => {
    const isMoved = await service.moveToProject(createTask('task-1'), 'project-a');

    expect(isMoved).toBe(false);
    expect(taskService.moveToProject).not.toHaveBeenCalled();
  });

  it('moves non-recurring tasks directly', async () => {
    const task = createTask('task-1');

    const isMoved = await service.moveToProject(task, 'project-b');

    expect(isMoved).toBe(true);
    expect(taskService.moveToProject).toHaveBeenCalledOnceWith(task, 'project-b');
  });

  it('updates repeat config and moves the task without confirmation for a single active recurring instance', async () => {
    const task = createTask('task-1', { repeatCfgId: 'repeat-1' });
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([task]));

    const isMoved = await service.moveToProject(task, 'project-b');

    expect(isMoved).toBe(true);
    expect(matDialog.open).not.toHaveBeenCalled();
    expect(taskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
      'repeat-1',
      { projectId: 'project-b' },
    );
    expect(taskService.moveToProject).toHaveBeenCalledOnceWith(task, 'project-b');
  });

  it('does not move recurring tasks when the confirmation is cancelled', async () => {
    const task = createTask('task-1', { repeatCfgId: 'repeat-1' });
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
      of([task, createTask('task-2', { repeatCfgId: 'repeat-1' })]),
    );
    matDialog.open.and.returnValue(dialogRef(false));

    const isMoved = await service.moveToProject(task, 'project-b');

    expect(isMoved).toBe(false);
    expect(matDialog.open).toHaveBeenCalledOnceWith(DialogConfirmComponent, {
      data: {
        okTxt: T.F.TASK_REPEAT.D_CONFIRM_MOVE_TO_PROJECT.OK,
        message: T.F.TASK_REPEAT.D_CONFIRM_MOVE_TO_PROJECT.MSG,
        translateParams: {
          projectName: 'Project B',
          tasksNr: 2,
        },
      },
    });
    expect(taskRepeatCfgService.updateTaskRepeatCfg).not.toHaveBeenCalled();
    expect(taskService.moveToProject).not.toHaveBeenCalled();
    expect(taskService.updateArchiveTasks).not.toHaveBeenCalled();
  });

  it('updates repeat config, active instances, and archived instances when recurring move is confirmed', async () => {
    const task = createTask('task-1', { repeatCfgId: 'repeat-1' });
    const secondTask = createTask('task-2', { repeatCfgId: 'repeat-1' });
    const archivedTask = createTask('archive-1', {
      repeatCfgId: 'repeat-1',
      subTaskIds: ['archive-sub-1'],
    });
    taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
      of([task, secondTask]),
    );
    taskService.getArchiveTasksForRepeatCfgId.and.resolveTo([archivedTask]);
    matDialog.open.and.returnValue(dialogRef(true));

    const isMoved = await service.moveToProject(task, 'project-b');

    expect(isMoved).toBe(true);
    expect(taskRepeatCfgService.updateTaskRepeatCfg).toHaveBeenCalledOnceWith(
      'repeat-1',
      { projectId: 'project-b' },
    );
    expect(taskService.moveToProject.calls.allArgs()).toEqual([
      [task, 'project-b'],
      [secondTask, 'project-b'],
    ]);
    expect(taskService.updateArchiveTasks).toHaveBeenCalledOnceWith([
      { id: 'archive-1', changes: { projectId: 'project-b' } },
      { id: 'archive-sub-1', changes: { projectId: 'project-b' } },
    ] as Update<Task>[]);
  });
});
