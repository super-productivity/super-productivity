import { TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY } from 'rxjs';
import { PluginBridgeContextService } from './plugin-bridge-context.service';
import { WorkContextService } from '../features/work-context/work-context.service';
import { TaskService } from '../features/tasks/task.service';
import { DateService } from '../core/date/date.service';
import {
  selectCurrentTaskId,
  selectTaskById,
} from '../features/tasks/store/task.selectors';
import { Task } from '../features/tasks/task.model';

describe('PluginBridgeContextService', () => {
  let service: PluginBridgeContextService;
  let store: MockStore;
  let taskService: jasmine.SpyObj<TaskService>;

  beforeEach(() => {
    taskService = jasmine.createSpyObj('TaskService', ['setCurrentId']);
    TestBed.configureTestingModule({
      providers: [
        PluginBridgeContextService,
        provideMockStore(),
        { provide: TaskService, useValue: taskService },
        { provide: WorkContextService, useValue: { activeWorkContext$: EMPTY } },
        {
          provide: DateService,
          useValue: {
            todayStr: () => '2026-10-30',
            getStartOfNextDayDiffMs: () => 4 * 60 * 60 * 1000,
          },
        },
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 1 } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
    service = TestBed.inject(PluginBridgeContextService);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => store.resetSelectors());

  it('reports the logical day with its offset and the first day of the week', async () => {
    expect(await service.getDayContext()).toEqual({
      todayStr: '2026-10-30',
      startOfNextDayDiffMs: 4 * 60 * 60 * 1000,
      firstDayOfWeek: 1,
    });
  });

  it('reports the tracked task id, or null', async () => {
    store.overrideSelector(selectCurrentTaskId, 'task-1');
    expect(await service.getCurrentTaskId()).toBe('task-1');

    store.overrideSelector(selectCurrentTaskId, null);
    store.refreshState();
    expect(await service.getCurrentTaskId()).toBeNull();
  });

  it('starts tracking an open task the way the play button does', async () => {
    store.overrideSelector(selectTaskById, { id: 'task-1', isDone: false } as Task);
    await service.startTracking('task-1');
    expect(taskService.setCurrentId).toHaveBeenCalledWith('task-1');
  });

  it('refuses to track an unknown or done task', async () => {
    store.overrideSelector(selectTaskById, undefined as unknown as Task);
    await expectAsync(service.startTracking('missing')).toBeRejected();

    store.overrideSelector(selectTaskById, { id: 'task-2', isDone: true } as Task);
    store.refreshState();
    await expectAsync(service.startTracking('task-2')).toBeRejected();
    expect(taskService.setCurrentId).not.toHaveBeenCalled();
  });

  it('stops tracking', async () => {
    await service.stopTracking();
    expect(taskService.setCurrentId).toHaveBeenCalledWith(null);
  });
});
