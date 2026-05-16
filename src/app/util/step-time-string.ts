const _parseTime = (timeStr: string): { hours: number; minutes: number } | null => {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);

  if (
    isNaN(hours) ||
    isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hours, minutes };
};

const _formatTime = (hours: number, minutes: number): string =>
  `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

export const stepTimeString = (timeStr: string, stepMinutes: number): string | null => {
  const parsed = _parseTime(timeStr);
  if (!parsed) return null;

  const hoursInMinutes = parsed.hours * 60;
  const totalMinutesRaw = hoursInMinutes + parsed.minutes + stepMinutes;
  const modded = totalMinutesRaw % 1440;
  const totalMinutes = (modded + 1440) % 1440;

  return _formatTime(Math.floor(totalMinutes / 60), totalMinutes % 60);
};
