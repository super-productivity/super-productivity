import {
  ackWidgetDoneQueueOnceWritten,
  getTaskDoneChangesToApply,
  getWidgetProjectRoute,
} from './android-widget.effects';
import { Task } from '../../tasks/task.model';
import { Dictionary } from '@ngrx/entity';
import { Project } from '../../project/project.model';

/**
 * The effects themselves are gated by IS_ANDROID_WEB_VIEW (false in tests), so
 * we test the drain decision logic directly (repo convention, see
 * android-sync-bridge.effects.spec.ts).
 */
describe('AndroidWidgetEffects - getTaskDoneChangesToApply', () => {
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

describe('AndroidWidgetEffects - ackWidgetDoneQueueOnceWritten', () => {
  it('should acknowledge the read queue only after the op writes finished', async () => {
    const calls: string[] = [];
    let finishFlush!: () => void;
    const done = ackWidgetDoneQueueOnceWritten('{"a":true}', {
      flushPendingWrites: () =>
        new Promise<void>((resolve) => {
          finishFlush = () => {
            calls.push('flushed');
            resolve();
          };
        }),
      hasUnrecoveredPersistFailure: () => false,
      waitForDeferredWrites: () => Promise.resolve(),
      ack: (queueJson) => calls.push(`ack ${queueJson}`),
    });

    await Promise.resolve();
    expect(calls).toEqual([]);

    finishFlush();
    await done;
    expect(calls).toEqual(['flushed', 'ack {"a":true}']);
  });

  it('should keep the queue when the op writes did not finish', async () => {
    const ack = jasmine.createSpy('ack');
    await ackWidgetDoneQueueOnceWritten('{"a":true}', {
      flushPendingWrites: () => Promise.reject(new Error('flush timeout')),
      hasUnrecoveredPersistFailure: () => false,
      waitForDeferredWrites: () => Promise.resolve(),
      ack,
    });
    expect(ack).not.toHaveBeenCalled();
  });

  it('should keep the queue when an op write failed', async () => {
    const ack = jasmine.createSpy('ack');
    await ackWidgetDoneQueueOnceWritten('{"a":true}', {
      flushPendingWrites: () => Promise.resolve(),
      hasUnrecoveredPersistFailure: () => true,
      waitForDeferredWrites: () => Promise.resolve(),
      ack,
    });
    expect(ack).not.toHaveBeenCalled();
  });

  it('should keep the queue while a tap applied during a sync is still unwritten', async () => {
    const ack = jasmine.createSpy('ack');
    let finishDeferredWrites!: () => void;
    const done = ackWidgetDoneQueueOnceWritten('{"a":true}', {
      flushPendingWrites: () => Promise.resolve(),
      hasUnrecoveredPersistFailure: () => false,
      waitForDeferredWrites: () =>
        new Promise<void>((resolve) => (finishDeferredWrites = resolve)),
      ack,
    });
    await Promise.resolve();
    expect(ack).not.toHaveBeenCalled();
    finishDeferredWrites();
    await done;
    expect(ack).toHaveBeenCalledOnceWith('{"a":true}');
  });
});

describe('AndroidWidgetEffects - getWidgetProjectRoute', () => {
  it('should route a project widget to the selected project task list', () => {
    expect(getWidgetProjectRoute('work', { id: 'work' } as Project)).toBe(
      'project/work/tasks',
    );
  });

  it('should leave the current route unchanged when the selected project was deleted', () => {
    expect(getWidgetProjectRoute('deleted', undefined)).toBeNull();
  });
});
