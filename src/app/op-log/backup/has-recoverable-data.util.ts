import { countAllTasks } from '../../imex/local-backup/backup-ring.util';
import { hasMeaningfulStateData } from '../validation/has-meaningful-state-data.util';
import { DEFAULT_SIMPLE_COUNTERS } from '../../features/simple-counter/simple-counter.const';
import { SimpleCounter } from '../../features/simple-counter/simple-counter.model';

const entityIdCount = (val: unknown): number => {
  const ids = (val as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids) ? ids.length : 0;
};

/**
 * Collections a user builds up over time that `hasMeaningfulStateData` leaves
 * out by design (its scope is task / project / tag / note). All start empty on
 * a fresh install, so any entry means the device holds work worth a recovery
 * point. Boards are excluded because the default boards are non-empty;
 * counters ship three defaults and get their own check below.
 */
const EXTRA_ENTITY_COLLECTIONS = ['taskRepeatCfg', 'issueProvider', 'metric'] as const;

const DEFAULT_COUNTER_BY_ID = new Map(DEFAULT_SIMPLE_COUNTERS.map((c) => [c.id, c]));

const isDefaultCounterUntouched = (counter: SimpleCounter): boolean => {
  const dflt = DEFAULT_COUNTER_BY_ID.get(counter.id);
  if (!dflt) {
    return false;
  }
  // Any customization or recorded activity (countOnDay) makes it user data.
  return Object.keys({ ...dflt, ...counter }).every(
    (key) =>
      JSON.stringify(counter[key as keyof SimpleCounter]) ===
      JSON.stringify(dflt[key as keyof SimpleCounter]),
  );
};

const hasUserCounters = (simpleCounter: unknown): boolean => {
  const ids = (simpleCounter as { ids?: unknown } | undefined)?.ids;
  const entities = (simpleCounter as { entities?: Record<string, SimpleCounter> })
    ?.entities;
  if (!Array.isArray(ids) || !entities) {
    return false;
  }
  return ids.some((id) => {
    const counter = entities[id];
    return !counter || !isDefaultCounterUntouched(counter);
  });
};

/**
 * "Is there anything on this device worth a recovery point?" — the skip guard
 * for `BackupService.captureRecoveryPointIfMeaningful`.
 *
 * Broader than `hasMeaningfulStateData` because it is consumed in the
 * refusing direction: a false negative here means a remote full-state op
 * overwrites the device with no snapshot to go back to. So it also counts
 * archived tasks, recurring-task configs, counters, issue providers, metrics
 * and plugin data. Settings alone are ignored — every synced full state
 * carries its own settings, and capturing for them would let a pristine
 * device rotate a real snapshot out of the ring.
 */
export const hasRecoverableData = (state: unknown): boolean => {
  if (!state || typeof state !== 'object') {
    return false;
  }
  if (countAllTasks(state) > 0 || hasMeaningfulStateData(state)) {
    return true;
  }
  const s = state as Record<string, unknown>;
  if (EXTRA_ENTITY_COLLECTIONS.some((key) => entityIdCount(s[key]) > 0)) {
    return true;
  }
  if (hasUserCounters(s.simpleCounter)) {
    return true;
  }
  return Array.isArray(s.pluginUserData) && s.pluginUserData.length > 0;
};
