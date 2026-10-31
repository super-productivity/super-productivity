import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { PluginTaskHistoryService } from './plugin-task-history.service';
import { OperationCaptureService } from '../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../op-log/sync/operation-write-flush.service';
import { TaskState } from '../features/tasks/task.model';
import { createStateWithExistingTasks } from '../root-store/meta/task-shared-meta-reducers/test-utils';
import {
  collectTaskHistory,
  mergeTaskHistory,
} from '../features/tasks/task-history/task-history.util';
import {
  bufferDeferredAction,
  clearDeferredActions,
} from '../op-log/capture/operation-capture.meta-reducer';
import { TaskSharedActions } from '../root-store/meta/task-shared.actions';

describe('PluginTaskHistoryService', () => {
  let service: PluginTaskHistoryService;
  let state: TaskState;
  let capture: OperationCaptureService;
  beforeEach(() => {
    state = createStateWithExistingTasks(['task1', 'task2']).tasks;
    for (let i = 0; i < 6; i++) {
      const next = {
        ...state,
        entities: {
          ...state.entities,
          task1: { ...state.entities.task1!, dueDay: `2026-11-0${i + 1}` },
        },
      };
      const envelope = collectTaskHistory(state, next, `op${i}`, 100 + i, 'update');
      state = { ...next, taskHistory: mergeTaskHistory(state.taskHistory, envelope) };
    }
    capture = new OperationCaptureService();
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { select: () => of(state) } },
        { provide: OperationCaptureService, useValue: capture },
        {
          provide: OperationWriteFlushService,
          useValue: {
            flushThenRunExclusive: async <T>(read: () => Promise<T>) => read(),
          },
        },
      ],
    });
    service = TestBed.inject(PluginTaskHistoryService);
  });
  afterEach(() => clearDeferredActions());

  it('paginates without mixing tasks or duplicating IDs', async () => {
    const one = await service.read('task1', { limit: 2 });
    const two = await service.read('task1', { limit: 2, cursor: one.nextCursor! });
    const three = await service.read('task1', { limit: 2, cursor: two.nextCursor! });
    expect(
      [...one.events, ...two.events, ...three.events].map((event) => event.operationId),
    ).toEqual(['op5', 'op4', 'op3', 'op2', 'op1', 'op0']);
    expect(three.nextCursor).toBeNull();
    expect(one.total).toBe(6);
    expect((await service.read('task2')).events).toEqual([]);
    await expectAsync(service.read('task2', { cursor: one.nextCursor! })).toBeRejected();
  });

  it('does not leak mutable store objects to plugin code', async () => {
    const page = await service.read('task1');
    page.events[0].after = { kind: 'unknown' };
    expect((await service.read('task1')).events[0].after).toEqual({
      kind: 'day',
      value: '2026-11-06',
    });
  });

  it('rejects invalid paging and corrupted cursors', async () => {
    for (const limit of [0, -1, 201, 1.5, NaN])
      await expectAsync(service.read('task1', { limit })).toBeRejected();
    await expectAsync(service.read('task1', { cursor: 'broken cursor' })).toBeRejected();
  });

  it('reports unknown history without fabricating earlier events', async () => {
    const page = await service.read('task2');
    expect(page.recordingStartedAt).toBeNull();
    expect(page.createdAt).toBe(state.entities.task2!.created);
    expect(page.events).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('reads retained history by full ID after the task entity has been removed', async () => {
    const before = await service.read('task1');
    const { task1: removed, ...entities } = state.entities;
    expect(removed).toBeDefined();
    state = { ...state, ids: state.ids.filter((id) => id !== 'task1'), entities };
    const retained = await service.read('task1');
    expect(retained.events).toEqual(before.events);
    expect(retained.createdAt).toBe(before.createdAt);
    expect(retained.recordingStartedAt).toBe(before.recordingStartedAt);
  });

  it('rejects optimistic history after a failed write and while a deferred action is pending', async () => {
    capture.markUnrecoveredPersistFailure();
    await expectAsync(service.read('task1')).toBeRejectedWithError(/storage failed/);
    capture.clear();
    bufferDeferredAction(
      TaskSharedActions.setDeadline({ taskId: 'task1', deadlineDay: '2026-11-20' }),
    );
    await expectAsync(service.read('task1')).toBeRejectedWithError(/synchronization/);
  });

  it('rejects a deferred write that arrives while the history read waits for the lock', async () => {
    const flush = TestBed.inject(OperationWriteFlushService);
    spyOn(flush, 'flushThenRunExclusive').and.callFake(async (read) => {
      bufferDeferredAction(
        TaskSharedActions.setDeadline({ taskId: 'task1', deadlineDay: '2026-11-20' }),
      );
      return read();
    });

    await expectAsync(service.read('task1')).toBeRejectedWithError(/synchronization/);
  });

  it('returns a gap-only legacy record without inventing a baseline, event or time', async () => {
    state = {
      ...state,
      taskHistory: {
        ...state.taskHistory,
        task2: {
          events: {},
          gaps: Object.fromEntries([
            [
              'recording-unavailable:task2',
              {
                id: 'recording-unavailable:task2',
                taskId: 'task2',
                reason: 'recording-unavailable',
                detectedAt: null,
              },
            ],
          ]),
        },
      },
    };
    const page = await service.read('task2');
    expect(page.recordingStartedAt).toBeNull();
    expect(page.createdAt).toBe(state.entities.task2!.created);
    expect(page.events).toEqual([]);
    expect(page.gaps).toHaveSize(1);
    expect(page.gaps[0].detectedAt).toBeNull();
  });

  it('keeps one registration on reload and releases only the disabled plugin', () => {
    service.bind('viewer-a').registerTaskDetailBlock({ id: 'history', label: 'History' });
    service
      .bind('viewer-b')
      .registerTaskDetailBlock({ id: 'history', label: 'Other history' });
    service.bind('viewer-a').registerTaskDetailBlock({ id: 'history', label: 'Renamed' });
    expect(service.blocks()).toHaveSize(2);
    service.unregister('viewer-a');
    expect(service.blocks()).toEqual([
      { pluginId: 'viewer-b', id: 'history', label: 'Other history' },
    ]);
    expect(state.taskHistory!.task1.events).toBeDefined();
  });

  it('reads all 10,000 records in bounded pages without dropping or duplicating IDs', async () => {
    const sample = Object.values(state.taskHistory!.task1.events)[0];
    state = {
      ...state,
      taskHistory: {
        ...state.taskHistory,
        task1: {
          ...state.taskHistory!.task1,
          events: Object.fromEntries(
            Array.from({ length: 10000 }, (_, index) => {
              const operationId = `long-history-${index}`;
              const id = `${operationId}:task1:schedule`;
              return [id, { ...sample, id, operationId, occurredAt: 1000 + index }];
            }),
          ),
        },
      },
    };
    let cursor: string | undefined;
    const ids = new Set<string>();
    do {
      const page = await service.read('task1', { limit: 200, cursor });
      expect(page.events.length).toBeLessThanOrEqual(200);
      expect(page.total).toBe(10000);
      for (const event of page.events) {
        expect(ids.has(event.id)).toBeFalse();
        ids.add(event.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids.size).toBe(10000);
  });

  it('validates block labels and IDs at the public API boundary', () => {
    expect(() =>
      service.register('viewer', { id: '../bad', label: 'History' }),
    ).toThrow();
    expect(() => service.register('viewer', { id: 'history', label: '' })).toThrow();
    expect(() =>
      service.register('viewer', { id: 'history', label: 'x'.repeat(81) }),
    ).toThrow();
  });
});
