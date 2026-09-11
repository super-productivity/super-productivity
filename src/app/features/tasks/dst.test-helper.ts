/**
 * Spec-only helper: the ambient timezone's spring-forward sunday and the hour
 * it skips, derived rather than hardcoded so DST cases are exercised in every
 * zone the suite runs in (Berlin transitions in march, Los Angeles two weeks
 * earlier, Sydney in october). Returns null where there is no transition.
 */
export const findSpringForwardSunday = (
  year: number,
): { sunday: Date; missingHour: number } | null => {
  const dayMs = 24 * 60 * 60 * 1000;
  for (let month = 0; month < 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const start = new Date(year, month, day, 0, 0, 0, 0);
      if (start.getDate() !== day || start.getDay() !== 0) {
        continue;
      }
      // A spring-forward day is shorter than 24h.
      if (
        new Date(year, month, day + 1, 0, 0, 0, 0).getTime() - start.getTime() >=
        dayMs
      ) {
        continue;
      }
      // Deliberately starts at 1: a midnight transition (Azores-style 00:00
      // to 01:00) would need "12:30am" phrasing in the consuming specs, so
      // such zones return null and the specs skip, same as no-DST zones.
      for (let hour = 1; hour < 6; hour++) {
        if (new Date(year, month, day, hour, 30, 0, 0).getHours() !== hour) {
          return { sunday: start, missingHour: hour };
        }
      }
    }
  }
  return null;
};
