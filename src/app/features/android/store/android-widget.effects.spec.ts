import { getTaskIdsToMarkDone } from './android-widget.effects';
import { Task } from '../../tasks/task.model';
import { Dictionary } from '@ngrx/entity';

/**
 * The effects themselves are gated by IS_ANDROID_WEB_VIEW (false in tests), so
 * we test the drain decision logic directly (repo convention, see
 * android-sync-bridge.effects.spec.ts).
 */
describe('AndroidWidgetEffects - getTaskIdsToMarkDone', () => {
  const entities = (...tasks: { id: string; isDone?: boolean }[]): Dictionary<Task> =>
    Object.fromEntries(
      tasks.map((t) => [t.id, { id: t.id, isDone: !!t.isDone } as Task]),
    );

  it('should mark existing undone tasks done', () => {
    expect(getTaskIdsToMarkDone('["a","b"]', entities({ id: 'a' }, { id: 'b' }))).toEqual(
      ['a', 'b'],
    );
  });

  it('should dedupe repeated taps on the same task', () => {
    expect(getTaskIdsToMarkDone('["a","a","a"]', entities({ id: 'a' }))).toEqual(['a']);
  });

  it('should skip tasks deleted since the tap', () => {
    expect(getTaskIdsToMarkDone('["gone","a"]', entities({ id: 'a' }))).toEqual(['a']);
  });

  it('should skip already-done tasks (no redundant update ops)', () => {
    expect(
      getTaskIdsToMarkDone('["a","b"]', entities({ id: 'a', isDone: true }, { id: 'b' })),
    ).toEqual(['b']);
  });

  it('should return empty for invalid JSON', () => {
    expect(getTaskIdsToMarkDone('not json', entities({ id: 'a' }))).toEqual([]);
  });

  it('should return empty for non-array JSON', () => {
    expect(getTaskIdsToMarkDone('{"a":1}', entities({ id: 'a' }))).toEqual([]);
  });
});
