import { BatchedTimeSyncEntry } from '../../core/util/batched-time-sync-accumulator';
import { SimpleCounter } from './simple-counter.model';

/**
 * The counter a `deleteSimpleCounter` op carries, so that a concurrent remote
 * update that wins over the delete restores it (#11465): the counter as the
 * other devices know it, not its live local state (#11495).
 *
 * - `isOn: false`: whether a stopwatch runs is local to this device. A restore
 *   must not start it here while it is stopped everywhere else.
 * - Stopwatch time ticked here but not yet flushed (`pendingEntries`, at most
 *   one sync interval) never became an op, so no other device has it. It is
 *   left out, the way a task delete drops its unflushed time. Flushing it
 *   first would not help: the restore rejects every pending local op of the
 *   counter, the flushed one with the delete.
 */
export const toDeletedSimpleCounterSnapshot = (
  counter: SimpleCounter,
  pendingEntries: readonly BatchedTimeSyncEntry[],
): SimpleCounter => {
  let countOnDay = counter.countOnDay;
  for (const { id, date, duration } of pendingEntries) {
    if (id !== counter.id || !Number.isFinite(duration) || duration <= 0) continue;
    const projected = Math.max(0, (countOnDay?.[date] || 0) - duration);
    countOnDay = { ...countOnDay };
    if (projected > 0) {
      countOnDay[date] = projected;
    } else {
      delete countOnDay[date];
    }
  }
  return { ...counter, isOn: false, countOnDay };
};
