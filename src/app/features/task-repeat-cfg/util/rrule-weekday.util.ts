/**
 * Shared normalizers for `rrule` option values, used by both the form builder
 * (`rrule-form.util`) and the legacy⇄RRULE converter (`legacy-cfg-to-rrule.util`).
 */

/** Coerce an rrule numeric option (`bymonthday`, `bymonth`, …) to a number[]. */
export const toNumArray = (v: unknown): number[] => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x): x is number => typeof x === 'number');
  return typeof v === 'number' ? [v] : [];
};

/** Normalize rrule's `byweekday` option to `{ weekday, n }` records. */
export const normalizeWeekdays = (v: unknown): { weekday: number; n?: number }[] => {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((w) => {
      if (typeof w === 'number') return { weekday: w };
      if (w && typeof w === 'object' && 'weekday' in w) {
        const wd = w as { weekday: number; n?: number };
        return { weekday: wd.weekday, n: wd.n ?? undefined };
      }
      return null;
    })
    .filter((x): x is { weekday: number; n?: number } => x !== null);
};
