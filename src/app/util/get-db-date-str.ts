//  'YYYY-MM-DD';

/*
⚠️ **Caution**: When parsing UTC ISO strings or timestamps from other timezones, the
 function will return the date in the **local timezone**, which may differ from the
  original date in the source timezone.
 */

export const getDbDateStr = (date: Date | number | string = new Date()): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isDBDateStr = (str: string): boolean => {
  if (str.length !== 10 || str[4] !== '-' || str[7] !== '-') return false;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) continue;
    const c = str.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
};

/** Validates both the YYYY-MM-DD shape and the actual Gregorian calendar day. */
export const isValidDBDateStr = (str: string): boolean => {
  if (!isDBDateStr(str)) return false;

  const year = Number(str.slice(0, 4));
  const month = Number(str.slice(5, 7));
  const day = Number(str.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
};
