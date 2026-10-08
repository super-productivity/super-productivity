import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TaskDuplicateService } from './task-duplicate.service';
import { TaskService } from './task.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from './task.model';
import { addSubTask } from './store/task.actions';

describe('TaskDuplicateService', () => {
  let service: TaskDuplicateService;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: jasmine.SpyObj<Store>;

  const subTask: Task = {
    ...DEFAULT_TASK,
    id: 'sub-task',
    title: 'Sub task',
    projectId: 'project-1',
    isDone: true,
    dueDay: '2026-09-02',
    timeEstimate: 3_600_000,
    notes: 'Sub task notes',
  };
  const timedSubTask: Task = {
    ...DEFAULT_TASK,
    id: 'timed-sub-task',
    title: 'Timed sub task',
    projectId: 'project-1',
    dueWithTime: 1_757_000_000_000,
  };
  const parentTask: TaskWithSubTasks = {
    ...DEFAULT_TASK,
    id: 'parent-task',
    title: 'Parent task',
    projectId: 'project-1',
    tagIds: ['tag-1'],
    notes: 'Parent task notes',
    dueDay: '2026-09-01',
    timeEstimate: 7_200_000,
    subTaskIds: [subTask.id, timedSubTask.id],
    subTasks: [subTask, timedSubTask],
  };

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'createNewTaskWithDefaults',
    ]);
    store = jasmine.createSpyObj<Store>('Store', ['dispatch']);

    TestBed.configureTestingModule({
      providers: [
        TaskDuplicateService,
        { provide: TaskService, useValue: taskService },
        { provide: Store, useValue: store },
      ],
    });

    service = TestBed.inject(TaskDuplicateService);
  });

  it('duplicates a parent task and its subtasks', () => {
    const newSubTask: Task = {
      ...DEFAULT_TASK,
      id: 'new-sub-task',
      title: subTask.title,
      projectId: subTask.projectId,
    };
    const newTimedSubTask: Task = {
      ...DEFAULT_TASK,
      id: 'new-timed-sub-task',
      title: timedSubTask.title,
      projectId: timedSubTask.projectId,
    };
    taskService.add.and.returnValue('new-parent-task');
    taskService.createNewTaskWithDefaults.and.returnValues(newSubTask, newTimedSubTask);

    const result = service.duplicate(parentTask);

    expect(result).toBe('new-parent-task');
    expect(taskService.add).toHaveBeenCalledWith(
      'Parent task (copy)',
      false,
      {
        isDone: false,
        projectId: 'project-1',
        tagIds: ['tag-1'],
        notes: 'Parent task notes',
        dueDay: '2026-09-01',
        timeEstimate: 7_200_000,
      },
      false,
    );
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith({
      title: 'Sub task',
      additional: {
        isDone: true,
        projectId: 'project-1',
        dueDay: '2026-09-02',
        timeEstimate: 3_600_000,
        notes: 'Sub task notes',
      },
    });
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith({
      title: 'Timed sub task',
      additional: {
        isDone: false,
        projectId: 'project-1',
        dueWithTime: 1_757_000_000_000,
        timeEstimate: 0,
        notes: undefined,
      },
    });
    expect(store.dispatch).toHaveBeenCalledWith(
      addSubTask({
        task: newSubTask,
        parentId: 'new-parent-task',
      }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      addSubTask({
        task: newTimedSubTask,
        parentId: 'new-parent-task',
      }),
    );
  });

  it('keeps the priority of the task and of each subtask', () => {
    const prioritizedSubTask: Task = { ...subTask, id: 'sub-high', priority: 3 };
    const unprioritizedSubTask: Task = { ...subTask, id: 'sub-none', priority: null };
    taskService.add.and.returnValue('new-parent-task');
    taskService.createNewTaskWithDefaults.and.returnValue({
      ...DEFAULT_TASK,
      id: 'new-sub-task',
      projectId: 'project-1',
    });

    service.duplicate({
      ...parentTask,
      priority: 1,
      subTaskIds: [prioritizedSubTask.id, unprioritizedSubTask.id],
      subTasks: [prioritizedSubTask, unprioritizedSubTask],
    });

    expect(taskService.add.calls.mostRecent().args[2]).toEqual(
      jasmine.objectContaining({ priority: 1 }),
    );
    const additionals = taskService.createNewTaskWithDefaults.calls
      .allArgs()
      .map(([arg]) => arg.additional);
    expect(additionals[0]).toEqual(jasmine.objectContaining({ priority: 3 }));
    expect(additionals[1]).not.toEqual(jasmine.objectContaining({ priority: 3 }));
    expect(additionals[1]?.priority).toBeNull();
  });

  it('preserves legacy string priorities on parents and subtasks', () => {
    const legacySubTask: Task = { ...subTask, priority: 'high' };
    taskService.add.and.returnValue('new-parent-task');
    taskService.createNewTaskWithDefaults.and.returnValue({
      ...DEFAULT_TASK,
      id: 'new-sub-task',
      projectId: 'project-1',
    });

    service.duplicate({
      ...parentTask,
      priority: 'high',
      subTasks: [legacySubTask],
    } as TaskWithSubTasks);

    expect(taskService.add.calls.mostRecent().args[2]!.priority).toBe('high');
    expect(
      taskService.createNewTaskWithDefaults.calls.mostRecent().args[0].additional!
        .priority,
    ).toBe('high');
  });

  it('does not duplicate a subtask', () => {
    const result = service.duplicate({
      ...parentTask,
      parentId: 'another-parent',
    });

    expect(result).toBeNull();
    expect(taskService.add).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('does not duplicate a completed task', () => {
    const result = service.duplicate({
      ...parentTask,
      isDone: true,
    });

    expect(result).toBeNull();
    expect(taskService.add).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
