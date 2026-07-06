import { WorkContext } from './work-context.model';
import { fastArrayCompare } from '../../util/fast-array-compare';

/**
 * distinctUntilChanged comparator for activeWorkContext$. The active work
 * context selector re-runs every second while a task tracks time (task
 * entities get a new reference each tick), allocating a new WorkContext whose
 * content is usually identical. Returns true when two emissions are equivalent
 * for every field, so per-tick churn collapses to one emission while any real
 * change (context switch, task-membership change, theme/cfg edit, ...) still
 * emits. Arrays are compared by content (the selector regenerates them each
 * tick); all other fields (incl. nested theme/advancedCfg) are compared by
 * reference, which is correct under NgRx — a real change yields a new reference.
 */
export const isSameActiveWorkContext = (a: WorkContext, b: WorkContext): boolean => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (av === bv) {
      continue;
    }
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (!fastArrayCompare(av as unknown[], bv as unknown[])) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
};
