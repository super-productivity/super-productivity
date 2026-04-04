/**
 * Parse a human duration string like "1h30m", "45m", "2h" into milliseconds.
 * Returns NaN for unparseable input.
 */
export function parseDuration(input: string): number {
  const match = input.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || (!match[1] && !match[2])) return NaN;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  return (hours * 60 + minutes) * 60_000;
}
