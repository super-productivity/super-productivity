import { drainWidgetDoneQueue, getTaskDoneChangesToApply } from './widget.effects';
import { Task } from '../../tasks/task.model';
import { Dictionary } from '@ngrx/entity';
import type { WidgetDoneQueueLease } from '../widget-data.service';

/**
 * The effects themselves are gated by IS_WIDGET_PLATFORM (false in tests), so
 * we test the drain decision logic directly (repo convention, see
 * android-sync-bridge.effects.spec.ts).
 */
describe('WidgetEffects - getTaskDoneChangesToApply', () => {
  const entities = (...tasks: { id: string; isDone?: boolean }[]): Dictionary<Task> =>
    Object.fromEntries(
      tasks.map((t) => [t.id, { id: t.id, isDone: !!t.isDone } as Task]),
    );

  it('should mark undone tasks done', () => {
    expect(
      getTaskDoneChangesToApply(
        '{"a":true,"b":true}',
        entities({ id: 'a' }, { id: 'b' }),
      ),
    ).toEqual([
      { id: 'a', isDone: true },
      { id: 'b', isDone: true },
    ]);
  });

  it('should mark done tasks undone', () => {
    expect(
      getTaskDoneChangesToApply('{"a":false}', entities({ id: 'a', isDone: true })),
    ).toEqual([{ id: 'a', isDone: false }]);
  });

  it('should skip tasks deleted since the tap', () => {
    expect(
      getTaskDoneChangesToApply('{"gone":true,"a":true}', entities({ id: 'a' })),
    ).toEqual([{ id: 'a', isDone: true }]);
  });

  it('should skip tasks already in the target state (no redundant update ops)', () => {
    expect(
      getTaskDoneChangesToApply(
        '{"a":true,"b":true}',
        entities({ id: 'a', isDone: true }, { id: 'b' }),
      ),
    ).toEqual([{ id: 'b', isDone: true }]);
  });

  it('should treat a done→undone round trip as a no-op', () => {
    // last-wins map: tapping done then undone before the app runs → target false
    expect(getTaskDoneChangesToApply('{"a":false}', entities({ id: 'a' }))).toEqual([]);
  });

  it('should return empty for invalid JSON', () => {
    expect(getTaskDoneChangesToApply('not json', entities({ id: 'a' }))).toEqual([]);
  });

  it('should return empty for non-object JSON', () => {
    expect(getTaskDoneChangesToApply('["a"]', entities({ id: 'a' }))).toEqual([]);
    expect(getTaskDoneChangesToApply('null', entities({ id: 'a' }))).toEqual([]);
  });

  it('should skip non-boolean target values', () => {
    expect(getTaskDoneChangesToApply('{"a":"true"}', entities({ id: 'a' }))).toEqual([]);
  });
});

describe('drainWidgetDoneQueue', () => {
  const taskEntities = (...tasks: { id: string; isDone?: boolean }[]): Dictionary<Task> =>
    Object.fromEntries(
      tasks.map((task) => [task.id, { id: task.id, isDone: !!task.isDone } as Task]),
    );
  const stablePersistence = {
    hasUnrecoveredPersistFailure: (): boolean => false,
    isInSyncWindow: (): boolean => false,
    waitUntilOutsideSyncWindow: async (): Promise<void> => undefined,
  };
  const lease = (queueJson: string): WidgetDoneQueueLease => ({
    queueJson,
    acknowledgementToken: 'lease-token',
  });

  it('reads current task state after acquiring the native queue lease', async () => {
    const callOrder: string[] = [];

    await drainWidgetDoneQueue({
      ...stablePersistence,
      waitUntilOutsideSyncWindow: async () => {
        callOrder.push('waitUntilOutsideSyncWindow');
      },
      readQueue: async () => {
        callOrder.push('readQueue');
        return lease('{"a":true}');
      },
      readTaskEntities: async () => {
        callOrder.push('readTaskEntities');
        return taskEntities({ id: 'a' });
      },
      setDone: () => callOrder.push('setDone'),
      setUnDone: () => callOrder.push('setUnDone'),
      flushPendingWrites: async () => {
        callOrder.push('flushPendingWrites');
      },
      pushSnapshot: async () => {
        callOrder.push('pushSnapshot');
        return true;
      },
      acknowledgeQueue: async () => {
        callOrder.push('acknowledgeQueue');
      },
    });

    expect(callOrder).toEqual([
      'waitUntilOutsideSyncWindow',
      'readQueue',
      'waitUntilOutsideSyncWindow',
      'readTaskEntities',
      'setDone',
      'flushPendingWrites',
      'pushSnapshot',
      'acknowledgeQueue',
    ]);
  });

  it('keeps the queue leased when durable op-log persistence fails', async () => {
    const acknowledgeQueue = jasmine.createSpy('acknowledgeQueue');

    await expectAsync(
      drainWidgetDoneQueue({
        ...stablePersistence,
        readQueue: async () => lease('{"a":true}'),
        readTaskEntities: async () => taskEntities({ id: 'a' }),
        setDone: () => undefined,
        setUnDone: () => undefined,
        flushPendingWrites: async () => {
          throw new Error('write failed');
        },
        pushSnapshot: async () => true,
        acknowledgeQueue,
      }),
    ).toBeRejectedWithError('write failed');

    expect(acknowledgeQueue).not.toHaveBeenCalled();
  });

  it('acknowledges a no-op target without creating a redundant operation', async () => {
    const setDone = jasmine.createSpy('setDone');
    const acknowledgeQueue = jasmine.createSpy('acknowledgeQueue');

    const changeCount = await drainWidgetDoneQueue({
      ...stablePersistence,
      readQueue: async () => lease('{"a":true}'),
      readTaskEntities: async () => taskEntities({ id: 'a', isDone: true }),
      setDone,
      setUnDone: () => undefined,
      flushPendingWrites: async () => undefined,
      pushSnapshot: async () => true,
      acknowledgeQueue,
    });

    expect(changeCount).toBe(0);
    expect(setDone).not.toHaveBeenCalled();
    expect(acknowledgeQueue).toHaveBeenCalledOnceWith(lease('{"a":true}'));
  });

  it('does not acknowledge when there is no queued target', async () => {
    const readTaskEntities = jasmine.createSpy('readTaskEntities');
    const acknowledgeQueue = jasmine.createSpy('acknowledgeQueue');

    const changeCount = await drainWidgetDoneQueue({
      ...stablePersistence,
      readQueue: async () => null,
      readTaskEntities,
      setDone: () => undefined,
      setUnDone: () => undefined,
      flushPendingWrites: async () => undefined,
      pushSnapshot: async () => true,
      acknowledgeQueue,
    });

    expect(changeCount).toBe(0);
    expect(readTaskEntities).not.toHaveBeenCalled();
    expect(acknowledgeQueue).not.toHaveBeenCalled();
  });

  it('keeps the queue leased when the updated native snapshot cannot be persisted', async () => {
    const acknowledgeQueue = jasmine.createSpy('acknowledgeQueue');

    await expectAsync(
      drainWidgetDoneQueue({
        ...stablePersistence,
        readQueue: async () => lease('{"a":true}'),
        readTaskEntities: async () => taskEntities({ id: 'a' }),
        setDone: () => undefined,
        setUnDone: () => undefined,
        flushPendingWrites: async () => undefined,
        pushSnapshot: async () => false,
        acknowledgeQueue,
      }),
    ).toBeRejectedWithError(
      'Failed to persist widget snapshot after draining done queue',
    );

    expect(acknowledgeQueue).not.toHaveBeenCalled();
  });

  it('keeps the lease when the real persistence path records a swallowed write failure', async () => {
    let hasPersistFailure = false;
    const acknowledgeQueue = jasmine.createSpy('acknowledgeQueue');

    await expectAsync(
      drainWidgetDoneQueue({
        ...stablePersistence,
        hasUnrecoveredPersistFailure: () => hasPersistFailure,
        readQueue: async () => lease('{"a":true}'),
        readTaskEntities: async () => taskEntities({ id: 'a' }),
        setDone: () => undefined,
        setUnDone: () => undefined,
        flushPendingWrites: async () => {
          hasPersistFailure = true;
        },
        pushSnapshot: async () => true,
        acknowledgeQueue,
      }),
    ).toBeRejectedWithError('Widget task operation failed to persist');

    expect(acknowledgeQueue).not.toHaveBeenCalled();
  });

  it('refuses a later no-op acknowledgement after any earlier write failure in the process', async () => {
    const acknowledgeQueue = jasmine.createSpy('acknowledgeQueue');

    await expectAsync(
      drainWidgetDoneQueue({
        ...stablePersistence,
        hasUnrecoveredPersistFailure: () => true,
        readQueue: async () => lease('{"a":true}'),
        readTaskEntities: async () => taskEntities({ id: 'a', isDone: true }),
        setDone: () => undefined,
        setUnDone: () => undefined,
        flushPendingWrites: async () => undefined,
        pushSnapshot: async () => true,
        acknowledgeQueue,
      }),
    ).toBeRejectedWithError(
      'Cannot drain widget queue after an op-log persistence failure',
    );

    expect(acknowledgeQueue).not.toHaveBeenCalled();
  });

  it('re-reads task state if a sync window opens during the async handoff', async () => {
    let isInSyncWindow = false;
    let readCount = 0;
    const setDone = jasmine.createSpy('setDone');

    await drainWidgetDoneQueue({
      ...stablePersistence,
      isInSyncWindow: () => isInSyncWindow,
      waitUntilOutsideSyncWindow: async () => {
        isInSyncWindow = false;
      },
      readQueue: async () => lease('{"a":true}'),
      readTaskEntities: async () => {
        readCount++;
        if (readCount === 1) {
          isInSyncWindow = true;
          return taskEntities({ id: 'a' });
        }
        return taskEntities({ id: 'a', isDone: true });
      },
      setDone,
      setUnDone: () => undefined,
      flushPendingWrites: async () => undefined,
      pushSnapshot: async () => true,
      acknowledgeQueue: async () => undefined,
    });

    expect(readCount).toBe(2);
    expect(setDone).not.toHaveBeenCalled();
  });
});
