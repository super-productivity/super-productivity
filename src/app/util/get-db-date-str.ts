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
