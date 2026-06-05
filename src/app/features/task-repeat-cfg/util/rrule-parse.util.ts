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

/** Parse an RRULE body; null when unparseable or lacking a FREQ. */
export const safeParseRRuleOptions = (
  rrule: string | undefined,
): RRuleParsedOptions | null => {
  if (!rrule || !rrule.trim()) return null;
  try {
    const opts = RRule.parseString(rrule);
    return opts.freq == null ? null : (opts as RRuleParsedOptions);
  } catch {
    return null;
  }
};

/** rrule Frequency → day-granular repeat cycle. Sub-daily FREQs are absent —
 *  callers treat a miss as "no legacy/day-granular equivalent". */
export const FREQ_TO_CYCLE: Partial<Record<number, RepeatCycleOption>> = {
  [Frequency.DAILY]: 'DAILY',
  [Frequency.WEEKLY]: 'WEEKLY',
  [Frequency.MONTHLY]: 'MONTHLY',
  [Frequency.YEARLY]: 'YEARLY',
};
