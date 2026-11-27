export const formatJiraDate = (date: Date | number | string): string => {
  const d = new Date(date);
  const pad = (num: number, length = 2): string => String(num).padStart(length, '0');

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  // Jira uses 2-digit milliseconds (SS format)
  const milliseconds = String(d.getMilliseconds()).padStart(3, '0').substring(0, 2);

  // Timezone offset without colon (to match moment's ZZ format)
  const offsetMinutes = d.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMinPart = Math.abs(offsetMinutes) % 60;
  // getTimezoneOffset returns POSITIVE for zones WEST of UTC, and NEGATIVE for EAST.
  // The standard ISO format requires the opposite sign (+ for EAST, - for WEST).
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';
  const offsetFormatted = `${offsetSign}${pad(offsetHours)}${pad(offsetMinPart)}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetFormatted}`;
};
