import { TranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectActiveWorkContext } from '../work-context/store/work-context.selectors';
import { selectSectionsByContextIdMap } from '../section/store/section.selectors';
import { selectPlannerState } from '../planner/store/planner.selectors';
import { plannerInitialState } from '../planner/store/planner.reducer';
import { DEFAULT_PROJECT } from '../project/project.const';
import { WorkContextType } from '../work-context/work-context.model';
import { moveTaskInTodayList } from '../work-context/store/work-context-meta.actions';
import { moveProjectTaskToBacklogList } from '../project/store/project.actions';
import { addTaskToSection } from '../section/store/section.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskDuplicateService } from './task-duplicate.service';
import { TaskService } from './task.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from './task.model';
import { addSubTask, moveSubTask } from './store/task.actions';

describe('TaskDuplicateService', () => {
  let service: TaskDuplicateService;
  let taskService: jasmine.SpyObj<TaskService>;
  let store: MockStore;
  let translate: jasmine.SpyObj<TranslateService>;
  const context = {
    ...DEFAULT_PROJECT,
    id: 'project-1',
    type: WorkContextType.PROJECT,
    routerLink: 'project/project-1',
    taskIds: ['parent-task'],
  };

  const subTask: Task = {
    ...DEFAULT_TASK,
    id: 'sub-task',
    title: 'Sub task',
    projectId: 'project-1',
    isDone: true,
    dueDay: '2026-09-02',
    timeEstimate: 3_600_000,
    notes: 'Sub task notes',
    attachments: [{ id: 'sub-link', type: 'LINK', path: 'https://example.test/sub' }],
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
    attachments: [
      { id: 'parent-link', type: 'LINK', path: 'https://example.test/parent' },
    ],
    dueDay: '2026-09-01',
    timeEstimate: 7_200_000,
    subTaskIds: [subTask.id, timedSubTask.id],
    subTasks: [subTask, timedSubTask],
  };

  beforeEach(() => {
    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.returnValue(' (copy)');
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'createNewTaskWithDefaults',
    ]);

    TestBed.configureTestingModule({
      providers: [
        TaskDuplicateService,
        { provide: TranslateService, useValue: translate },
        { provide: TaskService, useValue: taskService },
        provideMockStore({
          selectors: [
            { selector: selectActiveWorkContext, value: context },
            { selector: selectSectionsByContextIdMap, value: new Map() },
            { selector: selectPlannerState, value: plannerInitialState },
          ],
        }),
      ],
    });

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
    service = TestBed.inject(TaskDuplicateService);
  });

  it('marks a bulk copy and keeps short syntax in its literal title', () => {
    taskService.add.and.returnValue('new-parent');
    translate.instant.and.returnValue(' (Kopie)');
    service.duplicate({ ...parentTask, title: 'Literal @tomorrow', subTasks: [] }, true);
    expect(taskService.add).toHaveBeenCalledWith(
      'Literal @tomorrow (Kopie)',
      false,
      jasmine.objectContaining({
        notes: parentTask.notes,
        attachments: parentTask.attachments,
      }),
      false,
      true,
    );
  });

  it('duplicates a selected standalone subtask under its existing parent', () => {
    const copy = { ...subTask, id: 'new-child', parentId: 'parent', isDone: false };
    taskService.createNewTaskWithDefaults.and.returnValue(copy);
    const id = service.duplicate({ ...subTask, parentId: 'parent', subTasks: [] }, true);
    expect(id).toBe('new-child');
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
      jasmine.objectContaining({
        title: 'Sub task (copy)',
        additional: jasmine.objectContaining({
          parentId: 'parent',
          notes: subTask.notes,
          attachments: subTask.attachments,
          isDone: false,
        }),
      }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      addSubTask({ task: copy, parentId: 'parent' }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: '[Planner] Plan Task for Day',
        task: copy,
        day: subTask.dueDay,
      }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      moveSubTask({
        taskId: copy.id,
        srcTaskId: 'parent',
        targetTaskId: 'parent',
        afterTaskId: subTask.id,
      }),
    );
    expect(taskService.add).not.toHaveBeenCalled();
  });

  it('creates a foreign bulk copy without placing it in the active project', () => {
    taskService.add.and.returnValue('copy');
    const copy = service.duplicate(
      { ...parentTask, id: 'foreign', projectId: 'other', subTasks: [] },
      true,
    );
    expect(copy).toBe('copy');
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches placement once when duplicating a bulk root in the active list', () => {
    taskService.add.and.returnValue('copy');
    service.duplicate({ ...parentTask, subTasks: [] }, true);
    expect(store.dispatch).toHaveBeenCalledOnceWith(
      moveTaskInTodayList({
        taskId: 'copy',
        afterTaskId: parentTask.id,
        workContextId: context.id,
        workContextType: context.type,
        src: 'UNDONE',
        target: 'UNDONE',
      }),
    );
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
        attachments: parentTask.attachments,
        dueDay: '2026-09-01',
        timeEstimate: 7_200_000,
      },
      false,
      true,
    );
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith({
      title: 'Sub task',
      additional: {
        parentId: 'new-parent-task',
        isDone: true,
        projectId: 'project-1',
        dueDay: '2026-09-02',
        timeEstimate: 3_600_000,
        notes: 'Sub task notes',
        attachments: subTask.attachments,
      },
    });
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith({
      title: 'Timed sub task',
      additional: {
        parentId: 'new-parent-task',
        isDone: false,
        projectId: 'project-1',
        dueWithTime: 1_757_000_000_000,
        timeEstimate: 0,
        notes: undefined,
        attachments: [],
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

  it('creates an undated subtask with its copied parent before applying defaults', () => {
    const undatedSubTask: Task = {
      ...DEFAULT_TASK,
      id: 'undated-sub-task',
      title: 'Undated sub task',
      parentId: parentTask.id,
      projectId: 'project-1',
    };
    taskService.add.and.returnValue('new-parent-task');
    const newSubTask: Task = {
      ...DEFAULT_TASK,
      id: 'new-undated-sub-task',
      title: undatedSubTask.title,
      projectId: undatedSubTask.projectId,
      parentId: 'new-parent-task',
    };
    taskService.createNewTaskWithDefaults.and.returnValue(newSubTask);

    service.duplicate({
      ...parentTask,
      subTaskIds: [undatedSubTask.id],
      subTasks: [undatedSubTask],
    });

    const additional =
      taskService.createNewTaskWithDefaults.calls.mostRecent().args[0].additional;
    expect(additional).toEqual(
      jasmine.objectContaining({
        parentId: 'new-parent-task',
        isDone: false,
      }),
    );
    expect(additional?.dueDay).toBeUndefined();
    expect(additional?.dueWithTime).toBeUndefined();
    expect((store.dispatch as jasmine.Spy).calls.allArgs()).toEqual([
      [
        addSubTask({
          task: newSubTask,
          parentId: 'new-parent-task',
        }),
      ],
      [
        moveTaskInTodayList({
          taskId: 'new-parent-task',
          afterTaskId: parentTask.id,
          workContextId: context.id,
          workContextType: context.type,
          src: 'UNDONE',
          target: 'UNDONE',
        }),
      ],
    ]);
  });

  it('keeps timed parent and all-day child deadlines', () => {
    const deadlineWithTime = 1_907_928_000_000;
    const deadlineRemindAt = deadlineWithTime - 900_000;
    taskService.add.and.returnValue('new-parent-task');
    taskService.createNewTaskWithDefaults.and.returnValue({
      ...subTask,
      id: 'copy-child',
    });
    service.duplicate({
      ...parentTask,
      deadlineWithTime,
      deadlineRemindAt,
      subTasks: [{ ...subTask, deadlineDay: '2030-06-17' }],
      subTaskIds: [subTask.id],
    });
    expect(taskService.add.calls.mostRecent().args[2]).toEqual(
      jasmine.objectContaining({ deadlineWithTime, deadlineRemindAt }),
    );
    expect(
      taskService.createNewTaskWithDefaults.calls.mostRecent().args[0].additional,
    ).toEqual(jasmine.objectContaining({ deadlineDay: '2030-06-17' }));
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

  it('keeps a subtask finished as wont do', () => {
    const wontDoSubTask: Task = {
      ...subTask,
      id: 'sub-wont-do',
      isDone: true,
      doneOn: 5,
      wontDoOn: 5,
    };
    taskService.add.and.returnValue('new-parent-task');
    taskService.createNewTaskWithDefaults.and.returnValue({
      ...DEFAULT_TASK,
      id: 'new-sub-task',
      projectId: 'project-1',
    });

    service.duplicate({
      ...parentTask,
      subTaskIds: [wontDoSubTask.id, subTask.id],
      subTasks: [wontDoSubTask, subTask],
    });

    const additionals = taskService.createNewTaskWithDefaults.calls
      .allArgs()
      .map(([arg]) => arg.additional);
    expect(additionals[0]).toEqual(
      jasmine.objectContaining({ isDone: true, doneOn: 5, wontDoOn: 5 }),
    );
    expect(additionals[1]?.wontDoOn).toBeUndefined();
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

  it('keeps short-syntax tokens literal when copying a title', () => {
    taskService.add.and.returnValue('copy');
    service.duplicate({ ...parentTask, title: 'Literal @tomorrow #tag', subTasks: [] });
    expect(taskService.add).toHaveBeenCalledWith(
      'Literal @tomorrow #tag (copy)',
      false,
      jasmine.objectContaining({ dueDay: parentTask.dueDay }),
      false,
      true,
    );
  });

  it('places the copy after the original in the active list', () => {
    taskService.add.and.returnValue('copy');
    service.duplicate({ ...parentTask, subTasks: [] });
    expect(store.dispatch).toHaveBeenCalledWith(
      moveTaskInTodayList({
        taskId: 'copy',
        afterTaskId: parentTask.id,
        workContextId: context.id,
        workContextType: context.type,
        src: 'UNDONE',
        target: 'UNDONE',
      }),
    );
  });

  it('keeps a backlog copy in the backlog beside its original', () => {
    store.overrideSelector(selectActiveWorkContext, {
      ...context,
      taskIds: [],
      backlogTaskIds: [parentTask.id],
    });
    taskService.add.and.returnValue('copy');
    service.duplicate({ ...parentTask, subTasks: [] });
    expect(store.dispatch).toHaveBeenCalledWith(
      moveProjectTaskToBacklogList({
        taskId: 'copy',
        afterTaskId: parentTask.id,
        workContextId: context.id,
      }),
    );
  });

  it('uses only the original section in the active context', () => {
    const section = {
      id: 'section',
      contextId: context.id,
      contextType: context.type,
      title: 'Section',
      taskIds: [parentTask.id],
    };
    store.overrideSelector(
      selectSectionsByContextIdMap,
      new Map([
        ['other-project', [{ ...section, id: 'foreign', contextId: 'other-project' }]],
        [context.id, [section]],
      ]),
    );
    taskService.add.and.returnValue('copy');
    service.duplicate({ ...parentTask, subTasks: [] });
    expect(store.dispatch).toHaveBeenCalledWith(
      addTaskToSection({
        sectionId: section.id,
        taskId: 'copy',
        afterTaskId: parentTask.id,
        sourceSectionId: null,
      }),
    );
    expect(store.dispatch).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ sectionId: 'foreign' }),
    );
  });

  for (const ids of [
    ['copy', 'before', 'parent-task', 'after'],
    ['before', 'parent-task', 'after', 'copy'],
  ]) {
    it(`keeps future Planner placement when the copy starts at index ${ids.indexOf('copy')}`, () => {
      const day = '2099-01-01';
      store.overrideSelector(selectPlannerState, {
        ...plannerInitialState,
        days: { [day]: ids },
      });
      taskService.add.and.returnValue('copy');
      service.duplicate({ ...parentTask, dueDay: '2099-01-01', subTasks: [] });
      expect(store.dispatch).toHaveBeenCalledWith(
        PlannerActions.moveInList({
          targetDay: '2099-01-01',
          fromIndex: ids.indexOf('copy'),
          toIndex:
            ids.indexOf('parent-task') +
            (ids.indexOf('copy') > ids.indexOf('parent-task') ? 1 : 0),
        }),
      );
    });
  }
});
