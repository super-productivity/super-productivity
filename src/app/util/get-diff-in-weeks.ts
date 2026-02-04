/**
 * Returns the number of complete weeks between d1 and d2 (d2 - d1).
 * Uses Math.floor so partial weeks round toward zero for positive diffs.
 * NOTE: Callers always pass d1 <= d2 (start date, then later check date).
 * For negative diffs, Math.floor rounds away from zero (e.g. -0.5 → -1).
 */
export const getDiffInWeeks = (d1: Date, d2: Date): number => {
  const d1Copy = new Date(d1);
  const d2Copy = new Date(d2);
  // NOTE we want the diff regarding the dates not the absolute one
  d1Copy.setHours(0, 0, 0, 0);
  d2Copy.setHours(0, 0, 0, 0);
  const diffMs = d2Copy.getTime() - d1Copy.getTime();
  // Round days to handle DST (167h vs 168h), then floor weeks to respect week boundaries
  const diffInDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffInDays / 7);
};
