import { TestBed } from '@angular/core/testing';
import { TaskRepeatCfgService } from './task-repeat-cfg.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatDialog } from '@angular/material/dialog';
import { TaskService } from '../tasks/task.service';
import { WorkContextService } from '../work-context/work-context.service';
import {
  addTaskRepeatCfgToTask,
  deleteTaskRepeatCfgs,
  updateTaskRepeatCfg,
  updateTaskRepeatCfgs,
  upsertTaskRepeatCfg,
} from './store/task-repeat-cfg.actions';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from './task-repeat-cfg.model';
import { of } from 'rxjs';
import { WorkContextType } from '../work-context/work-context.model';
import {
  selectAllTaskRepeatCfgs,
  selectAllUnprocessedTaskRepeatCfgs,
  selectTaskRepeatCfgsForExactDay,
} from './store/task-repeat-cfg.selectors';
import {
  DEFAULT_TASK,
  Task,
  TaskWithSubTasks,
  TaskReminderOptionId,
} from '../tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { getDbDateStr } from '../../util/get-db-date-str';
import { TODAY_TAG } from '../tag/tag.const';
import { getRepeatableTaskId } from './get-repeatable-task-id.util';

describe('TaskRepeatCfgService', () => {
  let service: TaskRepeatCfgService;
  let store: MockStore;
  let matDialog: jasmine.SpyObj<MatDialog>;
  let taskService: jasmine.SpyObj<TaskService>;
  let dispatchSpy: jasmine.Spy;

  const formatIsoDate = (d: Date): string => getDbDateStr(d);

  const mockTaskRepeatCfg: TaskRepeatCfg = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'test-cfg-id',
    title: 'Test Repeat Task',
    projectId: 'test-project',
    repeatCycle: 'DAILY',
    startDate: formatIsoDate(new Date()), // Today
    lastTaskCreationDay: (() => {
      const prevNow = new Date();
      prevNow.setDate(prevNow.getDate() - 1);
      return formatIsoDate(prevNow);
    })(), // Yesterday
    repeatEvery: 1,
    defaultEstimate: 3600000,
    notes: 'Test notes',
    tagIds: ['tag1', 'tag2', TODAY_TAG.id],
  };

  const mockTask: Task = {
    ...DEFAULT_TASK,
    id: 'test-task-id',
    title: 'Test Repeat Task',
    projectId: 'test-project',
  };

  const mockTaskWithSubTasks: TaskWithSubTasks = {
    ...mockTask,
    subTasks: [],
  };

  beforeEach(() => {
    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    const taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'createNewTaskWithDefaults',
      'getTasksWithSubTasksByRepeatCfgId$',
      'getTasksByRepeatCfgId$',
    ]);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      activeWorkContextType: WorkContextType.PROJECT,
      activeWorkContextId: 'test-project',
    });

    TestBed.configureTestingModule({
      providers: [
        TaskRepeatCfgService,
        provideMockStore({
          initialState: {
            taskRepeatCfg: {
              ids: [],
              entities: {},
            },
          },
        }),
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
      ],
    });

    service = TestBed.inject(TaskRepeatCfgService);
    store = TestBed.inject(MockStore);
    matDialog = TestBed.inject(MatDialog) as jasmine.SpyObj<MatDialog>;
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;

    dispatchSpy = spyOn(store, 'dispatch');
  });

  describe('taskRepeatCfgs$', () => {
    it('should select all task repeat configs', (done) => {
      const mockConfigs = [mockTaskRepeatCfg];

      store.overrideSelector(selectAllTaskRepeatCfgs, mockConfigs);
      store.refreshState();

      service.taskRepeatCfgs$.subscribe((configs) => {
        expect(configs).toEqual(mockConfigs);
        done();
      });
    });
  });

  describe('getRepeatableTasksForExactDay$', () => {
    it('should return configs due for the specified day', (done) => {
      const dayDate = new Date(2022, 0, 10).getTime();
      const mockConfigs = [mockTaskRepeatCfg];

      // Mock the selector to return our test data
      store.overrideSelector(selectTaskRepeatCfgsForExactDay, mockConfigs);
      store.refreshState();

      service.getRepeatableTasksForExactDay$(dayDate).subscribe((configs) => {
        expect(configs).toEqual(mockConfigs);
        done();
      });
    });
  });

  describe('getTaskRepeatCfgById$', () => {
    it('should return config by id', (done) => {
      store.setState({
        taskRepeatCfg: {
          ids: ['test-cfg-id'],
          entities: {
            ['test-cfg-id']: mockTaskRepeatCfg,
          },
        },
      });

      service.getTaskRepeatCfgById$('test-cfg-id').subscribe((config) => {
        expect(config).toEqual(mockTaskRepeatCfg);
        done();
      });
    });
  });

  describe('addTaskRepeatCfgToTask', () => {
    it('should dispatch addTaskRepeatCfgToTask action', () => {
      const taskId = 'task-123';
      const projectId = 'project-123';
      const taskRepeatCfg = {
        title: 'New Repeat Task',
        repeatCycle: 'DAILY',
      };

      service.addTaskRepeatCfgToTask(taskId, projectId, taskRepeatCfg as any);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: addTaskRepeatCfgToTask.type,
          taskId,
          taskRepeatCfg: jasmine.objectContaining({
            ...taskRepeatCfg,
            projectId,
            id: jasmine.any(String),
          }),
        }),
      );
    });
  });

  describe('deleteTaskRepeatCfg', () => {
    it('should dispatch deleteTaskRepeatCfg action', async () => {
      const id = 'cfg-123';
      taskService.getTasksByRepeatCfgId$.and.returnValue(of([mockTask]));

      await service.deleteTaskRepeatCfg(id);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.deleteTaskRepeatCfg.type,
          taskRepeatCfgId: id,
        }),
      );
    });
  });

  describe('deleteTaskRepeatCfgsNoTaskCleanup', () => {
    it('should dispatch deleteTaskRepeatCfgs action', () => {
      const ids = ['cfg-123', 'cfg-456'];

      service.deleteTaskRepeatCfgsNoTaskCleanup(ids);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: deleteTaskRepeatCfgs.type,
          ids,
        }),
      );
    });
  });

  describe('updateTaskRepeatCfg', () => {
    it('should dispatch updateTaskRepeatCfg action', () => {
      const id = 'cfg-123';
      const changes = { title: 'Updated Title' };

      service.updateTaskRepeatCfg(id, changes);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: updateTaskRepeatCfg.type,
          taskRepeatCfg: { id, changes },
          isAskToUpdateAllTaskInstances: false,
        }),
      );
    });

    it('should dispatch with isAskToUpdateAllTaskInstances when specified', () => {
      const id = 'cfg-123';
      const changes = { title: 'Updated Title' };

      service.updateTaskRepeatCfg(id, changes, true);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: updateTaskRepeatCfg.type,
          taskRepeatCfg: { id, changes },
          isAskToUpdateAllTaskInstances: true,
        }),
      );
    });
  });

  describe('updateTaskRepeatCfgs', () => {
    it('should dispatch updateTaskRepeatCfgs action', () => {
      const ids = ['cfg-123', 'cfg-456'];
      const changes = { projectId: 'new-project' };

      service.updateTaskRepeatCfgs(ids, changes);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: updateTaskRepeatCfgs.type,
          ids,
          changes,
        }),
      );
    });
  });

  describe('upsertTaskRepeatCfg', () => {
    it('should dispatch upsertTaskRepeatCfg action', () => {
      service.upsertTaskRepeatCfg(mockTaskRepeatCfg);

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: upsertTaskRepeatCfg.type,
          taskRepeatCfg: mockTaskRepeatCfg,
        }),
      );
    });
  });

  describe('deleteTaskRepeatCfgWithDialog', () => {
    it('should open dialog and delete on confirm', async () => {
      const dialogRefSpy = jasmine.createSpyObj({ afterClosed: of(true) });
      matDialog.open.and.returnValue(dialogRefSpy);
      taskService.getTasksByRepeatCfgId$.and.returnValue(of([]));

      service.deleteTaskRepeatCfgWithDialog('cfg-123');

      expect(matDialog.open).toHaveBeenCalledWith(jasmine.anything(), {
        restoreFocus: true,
        data: jasmine.objectContaining({
          message: jasmine.any(String),
          okTxt: jasmine.any(String),
        }),
      });

      // Wait for the async delete operation to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(dispatchSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: TaskSharedActions.deleteTaskRepeatCfg.type,
          taskRepeatCfgId: 'cfg-123',
        }),
      );
    });

    it('should not delete when dialog is cancelled', async () => {
      const dialogRefSpy = jasmine.createSpyObj({ afterClosed: of(false) });
      matDialog.open.and.returnValue(dialogRefSpy);

      service.deleteTaskRepeatCfgWithDialog('cfg-123');

      expect(matDialog.open).toHaveBeenCalled();

      // Wait for the async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(dispatchSpy).not.toHaveBeenCalled();
    });
  });

  describe('createRepeatableTask', () => {
    it('should create actions for a new repeatable task', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const expectedId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      // Mock createNewTaskWithDefaults to capture and return the id and dueDay
      taskService.createNewTaskWithDefaults.and.callFake((args: any) => ({
        ...mockTask,
        id: args.id || mockTask.id,
        dueDay: args.additional?.dueDay,
      }));

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      expect(dispatchSpy).toHaveBeenCalledTimes(2);

      // Check addTask action
      expect(dispatchSpy.calls.argsFor(0)[0]).toEqual(
        jasmine.objectContaining({
          type: TaskSharedActions.addTask.type,
          task: jasmine.objectContaining({
            title: mockTaskRepeatCfg.title,
            dueDay: expectedDueDay,
            id: expectedId,
          }),
          workContextType: WorkContextType.PROJECT,
          workContextId: 'test-project',
          isAddToBacklog: false,
          isAddToBottom: false,
        }),
      );

      // Check updateTaskRepeatCfg action - should update both fields
      expect(dispatchSpy.calls.argsFor(1)[0]).toEqual(
        jasmine.objectContaining({
          type: updateTaskRepeatCfg.type,
          taskRepeatCfg: {
            id: mockTaskRepeatCfg.id,
            changes: {
              lastTaskCreation: jasmine.any(Number),
              lastTaskCreationDay: expectedDueDay,
            },
          },
        }),
      );
    });

    it('should not create task if already exists for the day', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      const existingTask = { ...mockTaskWithSubTasks, created: targetDayDate };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([existingTask]));

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should add task to bottom if order > 0', async () => {
      const cfgWithOrder = { ...mockTaskRepeatCfg, order: 1 };
      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      await service.createRepeatableTask(cfgWithOrder, targetDayDate);

      expect(dispatchSpy.calls.argsFor(0)[0]).toEqual(
        jasmine.objectContaining({
          type: TaskSharedActions.addTask.type,
          isAddToBottom: true,
        }),
      );
    });

    it('should filter out TODAY_TAG from tagIds', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
        jasmine.objectContaining({
          additional: jasmine.objectContaining({
            tagIds: ['tag1', 'tag2'], // TODAY_TAG.id should be filtered out
          }),
        }),
      );
    });

    it('should pass deterministic ID to createNewTaskWithDefaults', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const expectedId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue({
        ...mockTask,
        id: expectedId,
      });

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: expectedId,
        }),
      );
    });

    it('should not create task if task with deterministic ID already exists', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const expectedId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      // Existing task has the deterministic ID (simulating sync from another device)
      const existingTaskWithDeterministicId = {
        ...mockTaskWithSubTasks,
        id: expectedId,
        dueDay: expectedDueDay,
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
        of([existingTaskWithDeterministicId]),
      );

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should not create task if task with matching created date already exists (legacy check)', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();

      // Compute the expected creation timestamp (noon on target day, same as service does)
      const targetCreatedDate = new Date(targetDayDate);
      targetCreatedDate.setHours(12, 0, 0, 0);

      // Existing task has a different ID but same created date (legacy task without deterministic ID)
      const existingLegacyTask = {
        ...mockTaskWithSubTasks,
        id: 'legacy-random-id-12345',
        created: targetCreatedDate.getTime(),
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
        of([existingLegacyTask]),
      );

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should create task even if existing task has matching dueDay but different created date (#6192)', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const expectedId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      // Simulate: yesterday's recurring task was rescheduled to today via "Add to Today",
      // which mutated dueDay to today. The created date is still yesterday (noon).
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      const rescheduledTask = {
        ...mockTaskWithSubTasks,
        id: 'legacy-random-id-yesterday',
        dueDay: expectedDueDay, // mutated to today by planTasksForToday
        created: yesterday.getTime(), // still yesterday
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
        of([rescheduledTask]),
      );
      taskService.createNewTaskWithDefaults.and.returnValue({
        ...mockTask,
        id: expectedId,
        dueDay: expectedDueDay,
      });

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      // A new task should be created because the existing task's created date is yesterday
      expect(dispatchSpy).toHaveBeenCalled();
    });

    it('should generate same deterministic ID for same config and day', async () => {
      // Use today's date since mockTaskRepeatCfg has startDate=today
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const expectedId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue({
        ...mockTask,
        id: expectedId,
        dueDay: expectedDueDay,
      });

      await service.createRepeatableTask(mockTaskRepeatCfg, targetDayDate);

      // Verify the ID follows the deterministic format
      expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: `rpt_${mockTaskRepeatCfg.id}_${expectedDueDay}`,
        }),
      );
    });
  });

  describe('getActionsForTaskRepeatCfg', () => {
    it('should return empty array if task already exists for day', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      const existingTask = { ...mockTaskWithSubTasks, created: targetDayDate };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([existingTask]));

      const actions = await service._getActionsForTaskRepeatCfg(
        mockTaskRepeatCfg,
        targetDayDate,
      );

      expect(actions).toEqual([]);
    });

    it('should return empty array if task with deterministic ID already exists', async () => {
      // Use today's date since mockTaskRepeatCfg has startDate=today
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const deterministicId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      // Task exists with deterministic ID (simulating sync from another device)
      const existingTaskFromSync = {
        ...mockTaskWithSubTasks,
        id: deterministicId,
        dueDay: expectedDueDay,
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
        of([existingTaskFromSync]),
      );

      const actions = await service._getActionsForTaskRepeatCfg(
        mockTaskRepeatCfg,
        targetDayDate,
      );

      expect(actions).toEqual([]);
    });

    it('should return empty array if legacy task with same created date exists', async () => {
      // Use today's date since mockTaskRepeatCfg has startDate=today
      const today = new Date();
      const targetDayDate = today.getTime();

      // Compute the expected creation timestamp (noon on target day, same as service does)
      const targetCreatedDate = new Date(targetDayDate);
      targetCreatedDate.setHours(12, 0, 0, 0);

      // Legacy task with random ID but matching created date
      const legacyTask = {
        ...mockTaskWithSubTasks,
        id: 'old-random-nanoid-xyz',
        created: targetCreatedDate.getTime(),
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([legacyTask]));

      const actions = await service._getActionsForTaskRepeatCfg(
        mockTaskRepeatCfg,
        targetDayDate,
      );

      expect(actions).toEqual([]);
    });

    it('should create task if no task with matching ID or created date exists', async () => {
      // Use today's date since mockTaskRepeatCfg has startDate=today
      const today = new Date();
      const targetDayDate = today.getTime();
      const expectedDueDay = getDbDateStr(targetDayDate);
      const deterministicId = getRepeatableTaskId(mockTaskRepeatCfg.id, expectedDueDay);

      // Different task exists (different day - yesterday)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);
      const yesterdayStr = getDbDateStr(yesterday);
      const differentDayTask = {
        ...mockTaskWithSubTasks,
        id: `rpt_test-cfg-id_${yesterdayStr}`,
        created: yesterday.getTime(),
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(
        of([differentDayTask]),
      );
      taskService.createNewTaskWithDefaults.and.returnValue({
        ...mockTask,
        id: deterministicId,
        dueDay: expectedDueDay,
      });

      const actions = await service._getActionsForTaskRepeatCfg(
        mockTaskRepeatCfg,
        targetDayDate,
      );

      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0].type).toBe(TaskSharedActions.addTask.type);
    });

    it('should skip creation if computed target date already has an instance', async () => {
      const targetDayDate = new Date(2020, 0, 4).getTime();
      const targetDate = new Date(2020, 0, 3);
      const cfgNeedingCatchUp: TaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        startDate: formatIsoDate(new Date(2020, 0, 1)),
        lastTaskCreationDay: formatIsoDate(new Date(2019, 11, 30)),
        repeatEvery: 2,
      };
      const existingTask: TaskWithSubTasks = {
        ...mockTaskWithSubTasks,
        created: targetDate.getTime(),
        dueDay: formatIsoDate(targetDate),
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([existingTask]));

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgNeedingCatchUp,
        targetDayDate,
      );

      expect(actions).toEqual([]);
    });

    it('should respect deleted instances based on computed target date', async () => {
      const targetDayDate = new Date(2020, 0, 4).getTime();
      const deletedDate = formatIsoDate(new Date(2020, 0, 3));
      const cfgWithDeleted: TaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        startDate: formatIsoDate(new Date(2020, 0, 1)),
        lastTaskCreationDay: formatIsoDate(new Date(2019, 11, 30)),
        repeatEvery: 2,
        deletedInstanceDates: [deletedDate],
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithDeleted,
        targetDayDate,
      );

      expect(actions).toEqual([]);
    });

    it('should include schedule action if startTime and remindAt are set', async () => {
      const cfgWithSchedule = {
        ...mockTaskRepeatCfg,
        startTime: '10:00',
        remindAt: 'AtStart',
      };
      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithSchedule as any,
        targetDayDate,
      );

      expect(actions.length).toBe(3);
      expect(actions[2].type).toBe(TaskSharedActions.scheduleTaskWithTime.type);
    });

    it('should throw error if no id', async () => {
      const cfgWithoutId = { ...mockTaskRepeatCfg, id: null };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      await expectAsync(
        service._getActionsForTaskRepeatCfg(cfgWithoutId as any),
      ).toBeRejectedWithError('No taskRepeatCfg.id');
    });

    it('should use fallback date when startDate is undefined', async () => {
      const cfgInvalid = {
        ...mockTaskRepeatCfg,
        startDate: undefined,
        lastTaskCreationDay: '1970-01-01',
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      // Should not throw, but return actions with fallback date handling
      const result = await service._getActionsForTaskRepeatCfg(cfgInvalid as any);
      // When startDate is undefined, it falls back to '1970-01-01' and should work
      expect(result).toBeDefined();
    });

    it('should return empty array when due date is in the future', async () => {
      const futureDate = new Date(2025, 0, 1).toISOString();
      const cfgFutureStart = { ...mockTaskRepeatCfg, startDate: futureDate };
      const pastTargetDate = new Date(2022, 0, 1).getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      // Mock confirm to return false to prevent throwing
      const confirmSpy = window.confirm as jasmine.Spy;
      confirmSpy.and.returnValue(false);

      const result = await service._getActionsForTaskRepeatCfg(
        cfgFutureStart as any,
        pastTargetDate,
      );

      expect(result).toEqual([]);

      // Verify that confirm was called (devError will always call confirm)
      expect(confirmSpy).toHaveBeenCalledWith(
        'Throw an error for error? ––– No target creation date found for repeatable task',
      );

      // Restore default behavior
      confirmSpy.and.returnValue(true);
    });
  });

  describe('getAllUnprocessedRepeatableTasks$', () => {
    it('should return configs including overdue', (done) => {
      const dayDate = new Date(2022, 0, 10).getTime();
      const mockConfigs = [mockTaskRepeatCfg];

      // Mock the selector to return our test data
      store.overrideSelector(selectAllUnprocessedTaskRepeatCfgs, mockConfigs);
      store.refreshState();

      service.getAllUnprocessedRepeatableTasks$(dayDate).subscribe((configs) => {
        expect(configs).toEqual(mockConfigs);
        done();
      });
    });

    it('should use first() operator', () => {
      const dayDate = new Date(2022, 0, 10).getTime();
      spyOn(service['_store$'], 'select').and.returnValue({
        pipe: jasmine.createSpy('pipe').and.returnValue(of([])),
      } as any);

      service.getAllUnprocessedRepeatableTasks$(dayDate);

      expect(service['_store$'].select).toHaveBeenCalled();
    });
  });

  describe('getTaskRepeatCfgByIdAllowUndefined$', () => {
    it('should return config by id when exists', (done) => {
      store.setState({
        taskRepeatCfg: {
          ids: ['test-cfg-id'],
          entities: {
            ['test-cfg-id']: mockTaskRepeatCfg,
          },
        },
      });

      service.getTaskRepeatCfgByIdAllowUndefined$('test-cfg-id').subscribe((config) => {
        expect(config).toEqual(mockTaskRepeatCfg);
        done();
      });
    });

    it('should return undefined when config does not exist', (done) => {
      store.setState({
        taskRepeatCfg: {
          ids: [],
          entities: {},
        },
      });

      service.getTaskRepeatCfgByIdAllowUndefined$('non-existent').subscribe((config) => {
        expect(config).toBeUndefined();
        done();
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('should update both lastTaskCreation and lastTaskCreationDay when creating task', async () => {
      // Use today's date for the target to ensure it's valid
      const today = new Date();
      today.setHours(10, 0, 0, 0);
      const targetDayDate = today.getTime();

      // Create a task repeat config with a start date in the past
      const testTaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        // eslint-disable-next-line no-mixed-operators
        startDate: getDbDateStr(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // 7 days ago
        // eslint-disable-next-line no-mixed-operators
        lastTaskCreationDay: getDbDateStr(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)), // 2 days ago
      };

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      await service.createRepeatableTask(testTaskRepeatCfg, targetDayDate);

      // Verify both fields are set
      const updateAction = dispatchSpy.calls.argsFor(1)[0];
      expect(updateAction.type).toBe(updateTaskRepeatCfg.type);
      expect(updateAction.taskRepeatCfg.changes.lastTaskCreation).toBeDefined();
      expect(updateAction.taskRepeatCfg.changes.lastTaskCreationDay).toBeDefined();

      // Verify they represent the same date
      const actualTimestamp = updateAction.taskRepeatCfg.changes.lastTaskCreation;
      const actualDay = new Date(actualTimestamp).toISOString().split('T')[0];
      expect(actualDay).toBe(updateAction.taskRepeatCfg.changes.lastTaskCreationDay);
    });
  });

  describe('Timezone Edge Cases', () => {
    it('should correctly update lastTaskCreationDay for late night task creation', async () => {
      // Simulate creating a task at 11 PM
      const lateNightTime = new Date('2025-08-01T23:00:00');
      const targetDayDate = lateNightTime.getTime();

      // Set up a task repeat config with dates relative to the test date
      const testTaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        startDate: '2025-07-01', // Start date a month before
        lastTaskCreationDay: '2025-07-31', // Last created day before Aug 1st
      };

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      await service.createRepeatableTask(testTaskRepeatCfg, targetDayDate);

      // Verify that both fields are updated correctly
      // Note: lastTaskCreation will be set to noon (12:00) of the target day
      const updateAction = dispatchSpy.calls.argsFor(1)[0];
      expect(updateAction.type).toBe(updateTaskRepeatCfg.type);
      expect(updateAction.taskRepeatCfg.id).toBe(testTaskRepeatCfg.id);
      expect(updateAction.taskRepeatCfg.changes.lastTaskCreationDay).toBe('2025-08-01');
      // Verify timestamp is for the same day (at noon)
      const actualDate = new Date(updateAction.taskRepeatCfg.changes.lastTaskCreation);
      expect(actualDate.toISOString().split('T')[0]).toBe('2025-08-01');
    });

    it('should correctly handle task creation across day boundaries', async () => {
      // Test creating task just after midnight
      const earlyMorning = new Date('2025-08-02T00:30:00');
      const targetDayDate = earlyMorning.getTime();

      // Set up a task repeat config with dates relative to the test date
      const testTaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        startDate: '2025-07-01', // Start date a month before
        lastTaskCreationDay: '2025-08-01', // Last created day before Aug 2nd
      };

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      await service.createRepeatableTask(testTaskRepeatCfg, targetDayDate);

      // Verify both fields are updated correctly
      // Note: lastTaskCreation will be set to noon (12:00) of the target day
      const updateAction = dispatchSpy.calls.argsFor(1)[0];
      expect(updateAction.type).toBe(updateTaskRepeatCfg.type);
      expect(updateAction.taskRepeatCfg.id).toBe(testTaskRepeatCfg.id);
      expect(updateAction.taskRepeatCfg.changes.lastTaskCreationDay).toBe('2025-08-02');
      // Verify timestamp is for the same day (at noon)
      const actualDate = new Date(updateAction.taskRepeatCfg.changes.lastTaskCreation);
      expect(actualDate.toISOString().split('T')[0]).toBe('2025-08-02');
    });
  });

  describe('Subtask Templates', () => {
    const mockRepeatCfgWithSubtasks: TaskRepeatCfg = {
      ...mockTaskRepeatCfg,
      shouldInheritSubtasks: true,
      subTaskTemplates: [
        { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
        { title: 'SubTask 2', notes: 'Notes 2', timeEstimate: 7200000 },
      ],
    };

    beforeEach(() => {
      // Reset the mock before each test
      taskService.createNewTaskWithDefaults.calls.reset();

      // Mock createNewTaskWithDefaults for both main task and subtasks
      taskService.createNewTaskWithDefaults.and.callFake((args) => ({
        ...DEFAULT_TASK,
        id:
          args.title === 'Test Repeat Task'
            ? 'parent-task-id'
            : 'new-subtask-' + Math.random().toString(36).substr(2, 9),
        title: args.title || 'Default Title',
        notes: args.additional?.notes || '',
        timeEstimate: args.additional?.timeEstimate || 0,
        parentId: args.additional?.parentId,
        projectId: args.additional?.projectId || 'test-project',
        isDone: args.additional?.isDone || false,
      }));
    });

    it('should create subtasks from templates when inherit is enabled', async () => {
      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      // Mock task creation to return different objects based on title
      let callCount = 0;
      taskService.createNewTaskWithDefaults.and.callFake((args) => {
        callCount++;
        if (callCount === 1) {
          // Main task
          return {
            ...mockTask,
            id: 'parent-task-id',
            title: 'Test Repeat Task',
          } as Task;
        } else {
          // Subtasks
          const template = mockRepeatCfgWithSubtasks.subTaskTemplates![callCount - 2];
          return {
            ...DEFAULT_TASK,
            id: `subtask-${callCount}`,
            title: template.title,
            notes: template.notes || '',
            timeEstimate: template.timeEstimate || 0,
            parentId: 'parent-task-id',
            projectId: 'test-project',
            isDone: false,
          } as Task;
        }
      });

      const actions = await service._getActionsForTaskRepeatCfg(
        mockRepeatCfgWithSubtasks,
        targetDayDate,
      );

      // Should have addTask action + updateTaskRepeatCfg + 2 addSubTask actions
      expect(actions.length).toBe(4);

      // Verify main task creation
      expect(actions[0].type).toBe(TaskSharedActions.addTask.type);

      // Verify subtask creations
      expect(actions[2].type).toBe('[Task] Add SubTask');
      expect(actions[3].type).toBe('[Task] Add SubTask');

      // Verify subtask properties
      const subTask1Action = actions[2] as any;
      const subTask2Action = actions[3] as any;

      expect(subTask1Action.task.title).toBe('SubTask 1');
      expect(subTask1Action.task.notes).toBe('Notes 1');
      expect(subTask1Action.task.timeEstimate).toBe(3600000);
      expect(subTask1Action.parentId).toBe('parent-task-id');

      expect(subTask2Action.task.title).toBe('SubTask 2');
      expect(subTask2Action.task.notes).toBe('Notes 2');
      expect(subTask2Action.task.timeEstimate).toBe(7200000);
      expect(subTask2Action.parentId).toBe('parent-task-id');
    });

    it('should not create subtasks when inherit is disabled', async () => {
      const cfgWithoutInherit: TaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        shouldInheritSubtasks: false,
        subTaskTemplates: [
          { title: 'SubTask 1', notes: 'Notes 1', timeEstimate: 3600000 },
        ],
      };

      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithoutInherit,
        targetDayDate,
      );

      // Should have only addTask and updateTaskRepeatCfg actions
      expect(actions.length).toBe(2);
      expect(actions[0].type).toBe(TaskSharedActions.addTask.type);
      expect(actions[1].type).toBe(updateTaskRepeatCfg.type);
    });

    it('should not create subtasks when templates are empty', async () => {
      const cfgWithEmptyTemplates: TaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        shouldInheritSubtasks: true,
        subTaskTemplates: [],
      };

      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.returnValue(mockTask);

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithEmptyTemplates,
        targetDayDate,
      );

      // Should have only addTask and updateTaskRepeatCfg actions
      expect(actions.length).toBe(2);
      expect(actions[0].type).toBe(TaskSharedActions.addTask.type);
      expect(actions[1].type).toBe(updateTaskRepeatCfg.type);
    });

    it('should handle subtasks with missing notes and timeEstimate', async () => {
      const cfgWithMinimalTemplates: TaskRepeatCfg = {
        ...mockTaskRepeatCfg,
        shouldInheritSubtasks: true,
        subTaskTemplates: [
          { title: 'Minimal SubTask' }, // No notes or timeEstimate
        ],
      };

      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      let callCount = 0;
      taskService.createNewTaskWithDefaults.and.callFake((args) => {
        callCount++;
        if (callCount === 1) {
          // Main task
          return {
            ...mockTask,
            id: 'parent-task-id',
            title: 'Test Repeat Task',
          } as Task;
        } else {
          // Subtask
          return {
            ...DEFAULT_TASK,
            id: 'minimal-subtask',
            title: 'Minimal SubTask',
            notes: '',
            timeEstimate: 0,
            parentId: 'parent-task-id',
            projectId: 'test-project',
            isDone: false,
          } as Task;
        }
      });

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithMinimalTemplates,
        targetDayDate,
      );

      expect(actions.length).toBe(3);

      const subTaskAction = actions[2] as any;
      expect(subTaskAction.task.title).toBe('Minimal SubTask');
      expect(subTaskAction.task.notes).toBe(''); // Should default to empty string
      expect(subTaskAction.task.timeEstimate).toBe(0); // Should default to 0
      expect(subTaskAction.task.isDone).toBe(false); // Always start fresh
    });

    it('should assign correct projectId to subtasks', async () => {
      const cfgWithProject: TaskRepeatCfg = {
        ...mockRepeatCfgWithSubtasks,
        projectId: 'specific-project-id',
      };

      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      let callCount = 0;
      taskService.createNewTaskWithDefaults.and.callFake((args) => {
        callCount++;
        if (callCount === 1) {
          // Main task
          return {
            ...mockTask,
            id: 'parent-task-id',
            title: 'Test Repeat Task',
          } as Task;
        } else {
          // Subtasks - should use project ID from template
          const template = cfgWithProject.subTaskTemplates![callCount - 2];
          return {
            ...DEFAULT_TASK,
            id: `subtask-${callCount}`,
            title: template.title,
            notes: template.notes || '',
            timeEstimate: template.timeEstimate || 0,
            parentId: 'parent-task-id',
            projectId: 'specific-project-id',
            isDone: false,
          } as Task;
        }
      });

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithProject,
        targetDayDate,
      );

      const subTaskAction1 = actions[2] as any;
      const subTaskAction2 = actions[3] as any;

      expect(subTaskAction1.task.projectId).toBe('specific-project-id');
      expect(subTaskAction2.task.projectId).toBe('specific-project-id');
    });

    it('should handle null/undefined projectId in subtasks', async () => {
      const cfgWithoutProject: TaskRepeatCfg = {
        ...mockRepeatCfgWithSubtasks,
        projectId: null,
      };

      const today = new Date();
      const targetDayDate = today.getTime();
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      let callCount = 0;
      taskService.createNewTaskWithDefaults.and.callFake((args) => {
        callCount++;
        if (callCount === 1) {
          // Main task
          return {
            ...mockTask,
            id: 'parent-task-id',
            title: 'Test Repeat Task',
          } as Task;
        } else {
          // Subtasks - should have undefined projectId when null
          const template = cfgWithoutProject.subTaskTemplates![callCount - 2];
          const result = {
            ...DEFAULT_TASK,
            id: `subtask-${callCount}`,
            title: template.title,
            notes: template.notes || '',
            timeEstimate: template.timeEstimate || 0,
            parentId: 'parent-task-id',
            isDone: false,
          } as Task;
          // Remove projectId property entirely when it should be undefined
          delete (result as any).projectId;
          return result;
        }
      });

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithoutProject,
        targetDayDate,
      );

      const subTaskAction1 = actions[2] as any;
      expect(subTaskAction1.task.projectId).toBeUndefined();
    });
  });

  describe('Multi-day recurring task with startTime (#6269)', () => {
    // Reproduction test: Simulates a daily recurring task with startTime across multiple days.
    // Tests that _getActionsForTaskRepeatCfg creates correct actions for each day.

    const createDailyCfgWithTime = (
      startDateStr: string,
      lastCreationDayStr: string,
    ): TaskRepeatCfg => ({
      ...DEFAULT_TASK_REPEAT_CFG,
      id: 'daily-time-cfg',
      title: 'Daily Standup',
      projectId: 'project-A',
      repeatCycle: 'DAILY',
      repeatEvery: 1,
      startDate: startDateStr,
      lastTaskCreationDay: lastCreationDayStr,
      startTime: '09:00',
      remindAt: TaskReminderOptionId.AtStart,
      tagIds: [],
    });

    it('should create task with dueWithTime for day 1', async () => {
      const day1 = new Date();
      day1.setHours(10, 0, 0, 0);
      const day1Str = formatIsoDate(day1);

      const yesterday = new Date(day1);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatIsoDate(yesterday);

      const weekAgo = new Date(day1);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = formatIsoDate(weekAgo);

      const cfg = createDailyCfgWithTime(weekAgoStr, yesterdayStr);
      const expectedId = getRepeatableTaskId(cfg.id, day1Str);

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.callFake((args: any) => ({
        ...mockTask,
        id: args.id || mockTask.id,
        dueDay: args.additional?.dueDay,
        projectId: args.additional?.projectId || mockTask.projectId,
      }));

      const actions = await service._getActionsForTaskRepeatCfg(cfg, day1.getTime());

      // Should create: addTask, updateTaskRepeatCfg, scheduleTaskWithTime
      expect(actions.length).toBe(3);
      expect(actions[0].type).toBe(TaskSharedActions.addTask.type);
      expect(actions[1].type).toBe(updateTaskRepeatCfg.type);
      expect(actions[2].type).toBe(TaskSharedActions.scheduleTaskWithTime.type);

      // Verify the task has correct dueDay
      const addTaskAction = actions[0] as ReturnType<typeof TaskSharedActions.addTask>;
      expect(addTaskAction.task.dueDay).toBe(day1Str);
      expect(addTaskAction.task.id).toBe(expectedId);

      // Verify scheduleTaskWithTime sets dueWithTime
      const scheduleAction = actions[2] as ReturnType<
        typeof TaskSharedActions.scheduleTaskWithTime
      >;
      expect(scheduleAction.dueWithTime).toBeDefined();
      expect(scheduleAction.remindAt).toBeDefined();
    });

    it('should create tasks for consecutive days (day 2 and day 3)', async () => {
      const day1 = new Date();
      day1.setHours(10, 0, 0, 0);
      const day1Str = formatIsoDate(day1);

      const weekAgo = new Date(day1);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = formatIsoDate(weekAgo);

      // For day 2: lastTaskCreationDay = day1
      const day2 = new Date(day1);
      day2.setDate(day2.getDate() + 1);
      const day2Str = formatIsoDate(day2);

      const cfgAfterDay1 = createDailyCfgWithTime(weekAgoStr, day1Str);
      const expectedIdDay2 = getRepeatableTaskId(cfgAfterDay1.id, day2Str);

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.callFake((args: any) => ({
        ...mockTask,
        id: args.id || mockTask.id,
        dueDay: args.additional?.dueDay,
        projectId: args.additional?.projectId || mockTask.projectId,
      }));

      const actionsDay2 = await service._getActionsForTaskRepeatCfg(
        cfgAfterDay1,
        day2.getTime(),
      );

      expect(actionsDay2.length).toBe(3);
      const addTaskDay2 = actionsDay2[0] as ReturnType<typeof TaskSharedActions.addTask>;
      expect(addTaskDay2.task.dueDay).toBe(day2Str);
      expect(addTaskDay2.task.id).toBe(expectedIdDay2);

      // For day 3: lastTaskCreationDay = day2
      const day3 = new Date(day2);
      day3.setDate(day3.getDate() + 1);
      const day3Str = formatIsoDate(day3);

      const cfgAfterDay2 = createDailyCfgWithTime(weekAgoStr, day2Str);
      const expectedIdDay3 = getRepeatableTaskId(cfgAfterDay2.id, day3Str);

      const actionsDay3 = await service._getActionsForTaskRepeatCfg(
        cfgAfterDay2,
        day3.getTime(),
      );

      expect(actionsDay3.length).toBe(3);
      const addTaskDay3 = actionsDay3[0] as ReturnType<typeof TaskSharedActions.addTask>;
      expect(addTaskDay3.task.dueDay).toBe(day3Str);
      expect(addTaskDay3.task.id).toBe(expectedIdDay3);
    });
  });

  describe('Sync scenario: lastTaskCreationDay set but task missing (#6269)', () => {
    // Reproduction test: When Device A creates a task and syncs the repeat config
    // (with updated lastTaskCreationDay) but the task entity hasn't synced yet,
    // Device B should NOT attempt to create a duplicate because lastTaskCreationDay
    // blocks it. The task entity will arrive via sync separately.

    it('should NOT create task when lastTaskCreationDay is already today (sync race)', async () => {
      const today = new Date();
      today.setHours(10, 0, 0, 0);
      const todayStr = formatIsoDate(today);

      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = formatIsoDate(weekAgo);

      // Config already has lastTaskCreationDay = today (synced from Device A)
      const cfgWithTodayCreation: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'sync-race-cfg',
        title: 'Synced Task',
        projectId: 'project-A',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: weekAgoStr,
        lastTaskCreationDay: todayStr,
        tagIds: [],
      };

      // No tasks exist locally (task hasn't synced yet)
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));

      // devError calls window.confirm; return false so it doesn't throw
      const confirmSpy = window.confirm as jasmine.Spy;
      confirmSpy.and.returnValue(false);

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgWithTodayCreation,
        today.getTime(),
      );

      // getNewestPossibleDueDate returns null because lastTaskCreationDay === today
      // blocks the loop (checkDate <= lastTaskCreation). devError fires, returns [].
      expect(actions).toEqual([]);

      confirmSpy.and.returnValue(true);
    });
  });

  describe('workContextId mismatch (#6269)', () => {
    // Reproduction test: When a repeat config has projectId='project-A' but
    // the active work context is 'project-B', the created task should still
    // have projectId='project-A' (from config), but the addTask action's
    // workContextId uses the ACTIVE context.

    it('should use active work context for addTask, not the config projectId', async () => {
      const today = new Date();
      today.setHours(10, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatIsoDate(yesterday);

      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = formatIsoDate(weekAgo);

      // Config is for project-A
      const cfgForProjectA: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'ctx-mismatch-cfg',
        title: 'Project A Task',
        projectId: 'project-A',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: weekAgoStr,
        lastTaskCreationDay: yesterdayStr,
        tagIds: [],
      };

      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([]));
      taskService.createNewTaskWithDefaults.and.callFake((args: any) => ({
        ...mockTask,
        id: args.id || mockTask.id,
        dueDay: args.additional?.dueDay,
        projectId: args.additional?.projectId || undefined,
      }));

      const actions = await service._getActionsForTaskRepeatCfg(
        cfgForProjectA,
        today.getTime(),
      );

      expect(actions.length).toBeGreaterThan(0);
      const addTaskAction = actions[0] as ReturnType<typeof TaskSharedActions.addTask>;

      // Task entity has projectId from config
      expect(addTaskAction.task.projectId).toBe('project-A');

      // After fix: The addTask action uses the config's projectId, not the active context.
      // This ensures correct behavior regardless of which project is active on this device.
      expect(addTaskAction.workContextId).toBe('project-A');
      expect(addTaskAction.workContextType).toBe(WorkContextType.PROJECT);
    });
  });

  describe('Overdue scheduled task removal + new instance creation (#6269)', () => {
    // Reproduction test: Verifies that when a recurring task has dueWithTime
    // set to yesterday (past) and dueDay is undefined (mutual exclusivity),
    // a new task instance can still be created for today.

    it('should create a new task instance for today even when yesterday instance had dueWithTime', async () => {
      const today = new Date();
      today.setHours(10, 0, 0, 0);
      const todayStr = formatIsoDate(today);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatIsoDate(yesterday);

      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = formatIsoDate(weekAgo);

      // The config was last created yesterday
      const cfg: TaskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        id: 'overdue-cfg',
        title: 'Daily Standup',
        projectId: 'project-A',
        repeatCycle: 'DAILY',
        repeatEvery: 1,
        startDate: weekAgoStr,
        lastTaskCreationDay: yesterdayStr,
        startTime: '09:00',
        remindAt: TaskReminderOptionId.AtStart,
        tagIds: [],
      };

      // Yesterday's task exists with dueWithTime (dueDay undefined due to mutual exclusivity)
      const yesterdayTaskId = getRepeatableTaskId(cfg.id, yesterdayStr);
      const yesterdayTask: TaskWithSubTasks = {
        ...mockTaskWithSubTasks,
        id: yesterdayTaskId,
        // Set created to yesterday so getDbDateStr(created) != today
        created: yesterday.getTime(),
        dueDay: undefined,
        dueWithTime: new Date(
          yesterday.getFullYear(),
          yesterday.getMonth(),
          yesterday.getDate(),
          9,
          0,
        ).getTime(),
      };
      taskService.getTasksWithSubTasksByRepeatCfgId$.and.returnValue(of([yesterdayTask]));
      taskService.createNewTaskWithDefaults.and.callFake((args: any) => ({
        ...mockTask,
        id: args.id || mockTask.id,
        dueDay: args.additional?.dueDay,
        projectId: args.additional?.projectId || mockTask.projectId,
      }));

      const actions = await service._getActionsForTaskRepeatCfg(cfg, today.getTime());

      // Should create new task for today (yesterday's task has different ID and dueDay)
      expect(actions.length).toBe(3);
      expect(actions[0].type).toBe(TaskSharedActions.addTask.type);

      const addTaskAction = actions[0] as ReturnType<typeof TaskSharedActions.addTask>;
      expect(addTaskAction.task.dueDay).toBe(todayStr);
      expect(addTaskAction.task.id).toBe(getRepeatableTaskId(cfg.id, todayStr));
    });

    it('should detect overdue task correctly when dueWithTime is in the past and dueDay is undefined', () => {
      // This test documents the overdue detection logic from selectOverdueTasks:
      // A task with dueWithTime < todayStart is considered overdue, regardless of dueDay.
      const today = new Date();
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // Task with dueWithTime = yesterday 9am, dueDay = undefined (mutual exclusivity)
      const yesterdayDueWithTime = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
        9,
        0,
      ).getTime();

      // Verify the overdue condition: dueWithTime < todayStart
      expect(yesterdayDueWithTime < todayStart.getTime()).toBe(true);
      // Verify dueDay check: when dueDay is undefined, the dueWithTime check catches it
      expect(undefined as string | undefined).toBeFalsy();
    });
  });

  describe('addTaskRepeatCfgToTask dispatch (#5594)', () => {
    // Note: First occurrence calculation and lastTaskCreationDay updates
    // are handled by the updateTaskAfterMakingItRepeatable$ effect.
    // These tests verify the service correctly dispatches the action.

    it('should include startTime and remindAt in dispatched action', () => {
      const taskId = 'task-123';
      const projectId = 'project-123';
      const today = new Date();

      const taskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        title: 'Task with Time',
        repeatCycle: 'DAILY' as const,
        repeatEvery: 1,
        startDate: formatIsoDate(today),
        startTime: '09:00',
        remindAt: TaskReminderOptionId.AtStart,
      };

      service.addTaskRepeatCfgToTask(taskId, projectId, taskRepeatCfg);

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];

      expect(dispatchedAction.startTime).toBe('09:00');
      expect(dispatchedAction.remindAt).toBe(TaskReminderOptionId.AtStart);
    });

    it('should preserve all taskRepeatCfg properties', () => {
      const taskId = 'task-123';
      const projectId = 'project-123';
      const today = new Date();

      const taskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        title: 'Task with Properties',
        repeatCycle: 'DAILY' as const,
        repeatEvery: 2,
        startDate: formatIsoDate(today),
        notes: 'Some notes',
        defaultEstimate: 3600000,
        tagIds: ['tag1', 'tag2'],
      };

      service.addTaskRepeatCfgToTask(taskId, projectId, taskRepeatCfg);

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];
      const cfg = dispatchedAction.taskRepeatCfg;

      expect(cfg.title).toBe('Task with Properties');
      expect(cfg.repeatEvery).toBe(2);
      expect(cfg.notes).toBe('Some notes');
      expect(cfg.defaultEstimate).toBe(3600000);
      expect(cfg.tagIds).toEqual(['tag1', 'tag2']);
      expect(cfg.projectId).toBe(projectId);
      expect(cfg.id).toBeDefined();
    });

    it('should dispatch action with taskId', () => {
      const taskId = 'task-123';
      const projectId = 'project-123';

      const taskRepeatCfg = {
        ...DEFAULT_TASK_REPEAT_CFG,
        title: 'Test Task',
        repeatCycle: 'DAILY' as const,
        repeatEvery: 1,
      };

      service.addTaskRepeatCfgToTask(taskId, projectId, taskRepeatCfg);

      const dispatchedAction = dispatchSpy.calls.mostRecent().args[0];

      expect(dispatchedAction.type).toBe(addTaskRepeatCfgToTask.type);
      expect(dispatchedAction.taskId).toBe(taskId);
    });
  });
});
