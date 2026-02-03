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
