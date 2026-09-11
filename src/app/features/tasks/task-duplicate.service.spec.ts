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
    timeEstimate: 3_600_000,
    notes: 'Sub task notes',
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
    subTaskIds: [subTask.id],
    subTasks: [subTask],
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
    taskService.add.and.returnValue('new-parent-task');
    taskService.createNewTaskWithDefaults.and.returnValue(newSubTask);

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
        timeEstimate: 3_600_000,
        notes: 'Sub task notes',
      },
    });
    expect(store.dispatch).toHaveBeenCalledWith(
      addSubTask({
        task: newSubTask,
        parentId: 'new-parent-task',
      }),
    );
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
