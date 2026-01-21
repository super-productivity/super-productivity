// Parse 'YYYY-MM-DD' string as a local date (not UTC)
//
// ⚠️ Important: new Date('2026-01-12') parses as UTC midnight, which becomes
// the previous day when converted to local timezone (e.g., Europe/Berlin UTC+1).
// This function parses the string as a local date to avoid timezone issues.
//
// Examples:
// - new Date('2026-01-12') in Europe/Berlin → 2026-01-11 23:00 (UTC midnight)
// - parseDbDateStr('2026-01-12') → 2026-01-12 00:00 (local midnight)

export const parseDbDateStr = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};
