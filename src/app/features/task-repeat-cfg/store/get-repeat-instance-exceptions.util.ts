import { RepeatInstanceOverride, TaskRepeatCfg } from '../task-repeat-cfg.model';

/**
 * Derives the RFC 5545 EXDATE / RDATE sets for the occurrence engine from a
 * cfg's per-instance exceptions:
 *   - skips (`deletedInstanceDates`)                  → EXDATE
 *   - moves (`instanceOverrides[d].movedToDay`)       → EXDATE(d) + RDATE(moved)
 * Field-only overrides (no `movedToDay`) don't change the occurrence set — they
 * only re-style the task at creation, so they're applied separately.
 */
export const getRepeatInstanceExceptions = (
  cfg: Pick<TaskRepeatCfg, 'deletedInstanceDates' | 'instanceOverrides'>,
): { exdates: string[]; rdates: string[] } => {
  const exdates = [...(cfg.deletedInstanceDates ?? [])];
  const rdates: string[] = [];
  const overrides = cfg.instanceOverrides;
  if (overrides) {
    for (const origDate of Object.keys(overrides)) {
      const moved = overrides[origDate].movedToDay;
      if (moved && moved !== origDate) {
        exdates.push(origDate);
        rdates.push(moved);
      }
    }
  }
  return { exdates, rdates };
};

/**
 * Finds the override that applies to a materialized occurrence landing on
 * `dayStr` — either a field-only override keyed at that day, or a move whose
 * target (`movedToDay`) is that day. Returns `undefined` when none applies.
 */
export const findRepeatInstanceOverride = (
  cfg: Pick<TaskRepeatCfg, 'instanceOverrides'>,
  dayStr: string,
): RepeatInstanceOverride | undefined => {
  const overrides = cfg.instanceOverrides;
  if (!overrides) return undefined;
  const direct = overrides[dayStr];
  if (direct && !direct.movedToDay) return direct; // field-only at this day
  for (const k of Object.keys(overrides)) {
    if (overrides[k].movedToDay === dayStr) return overrides[k];
  }
  return undefined;
};
