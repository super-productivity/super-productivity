import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TaskSchedulingService } from './task-scheduling.service';
import { TaskService } from './task.service';
import { DEFAULT_TASK, Task, TaskReminderOptionId } from './task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { GlobalConfigService } from '../config/global-config.service';

describe('TaskSchedulingService', () => {
  let service: TaskSchedulingService;
  let store: MockStore;

  const DUE = new Date(2026, 10, 25, 14, 0).getTime();
  const M15_MS = 15 * 60 * 1000;
  const task = { ...DEFAULT_TASK, id: 'task-1', title: 'Task 1' } as Task;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TaskSchedulingService,
        provideMockStore(),
        { provide: TaskService, useValue: {} },
        { provide: GlobalConfigService, useValue: {} },
      ],
    });
    service = TestBed.inject(TaskSchedulingService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  describe('scheduleTask', () => {
    it('should dispatch scheduleTaskWithTime with the full payload', () => {
      service.scheduleTask(task, DUE, TaskReminderOptionId.m15);

      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.scheduleTaskWithTime({
          task,
          dueWithTime: DUE,
          remindAt: DUE - M15_MS,
          isMoveToBacklog: false,
        }),
      );
    });
  });

  describe('reScheduleTask', () => {
    it('should dispatch reScheduleTaskWithTime with the full payload', () => {
      service.reScheduleTask({
        task,
        due: DUE,
        remindCfg: TaskReminderOptionId.AtStart,
        isMoveToBacklog: true,
      });

      expect(store.dispatch).toHaveBeenCalledOnceWith(
        TaskSharedActions.reScheduleTaskWithTime({
          task,
          dueWithTime: DUE,
          remindAt: DUE,
          isMoveToBacklog: true,
        }),
      );
    });
  });
});
