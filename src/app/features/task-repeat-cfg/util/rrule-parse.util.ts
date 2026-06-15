import { Frequency, RRule } from 'rrule';
import { RepeatCycleOption } from '../task-repeat-cfg.model';

/**
 * Shared fail-soft RRULE parsing for every layer that inspects a rule body
 * (occurrence engine, form builder, legacy converter, preview). One definition
 * of "parseable rule with a FREQ" — previously six hand-rolled try/catch
 * copies that had already drifted in their guards.
 */

export type RRuleParsedOptions = Partial<ReturnType<typeof RRule.parseString>> & {
  freq: Frequency;
};

// Rule strings are few, immutable, and re-parsed many times per keystroke (the
// dialog preview/validity computeds) and on every overdue/day-change scan. The
// regex parse is the cost; a tiny memo makes the repeats free. Callers treat the
// result as read-only (they spread it into a new options object, never mutate
// it), so a shared instance is safe.
const _parseCache = new Map<string, RRuleParsedOptions | null>();

/** Parse an RRULE body; null when unparseable or lacking a FREQ. */
export const safeParseRRuleOptions = (
  rrule: string | undefined,
): RRuleParsedOptions | null => {
  if (!rrule || !rrule.trim()) return null;
  const cached = _parseCache.get(rrule);
  if (cached !== undefined) return cached;
  let result: RRuleParsedOptions | null;
  try {
    const opts = RRule.parseString(rrule);
    result = opts.freq == null ? null : (opts as RRuleParsedOptions);
  } catch {
    result = null;
  }
  if (_parseCache.size > 200) _parseCache.clear();
  _parseCache.set(rrule, result);
  return result;
};

/** rrule Frequency → day-granular repeat cycle. Sub-daily FREQs are absent —
 *  callers treat a miss as "no legacy/day-granular equivalent". */
export const FREQ_TO_CYCLE: Partial<Record<number, RepeatCycleOption>> = {
  [Frequency.DAILY]: 'DAILY',
  [Frequency.WEEKLY]: 'WEEKLY',
  [Frequency.MONTHLY]: 'MONTHLY',
  [Frequency.YEARLY]: 'YEARLY',
};
