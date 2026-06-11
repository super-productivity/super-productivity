/**
 * Prev/next year navigation over the years a heatmap has data for. `years` is
 * sorted newest-first (as both heatmap consumers build it), so "prev" walks
 * toward the END of the list and "next" toward the front. Returns the target
 * year, or null when there is none (also when `selected` isn't in the list).
 */
export const prevYearOf = (years: number[], selected: number): number | null => {
  const i = years.indexOf(selected);
  return i !== -1 && i < years.length - 1 ? years[i + 1] : null;
};

export const nextYearOf = (years: number[], selected: number): number | null => {
  const i = years.indexOf(selected);
  return i > 0 ? years[i - 1] : null;
};
