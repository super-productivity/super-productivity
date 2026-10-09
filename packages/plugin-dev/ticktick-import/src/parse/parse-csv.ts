/**
 * Minimal RFC 4180 CSV reader: quoted fields may contain commas, `""` escapes
 * and line breaks (TickTick's `Content` column regularly does). A leading
 * UTF-8 BOM is stripped. Returns raw rows; blank lines are dropped.
 */
export const parseCsv = (text: string): string[][] => {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRow = (): void => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
    field = '';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch !== '"') {
        field += ch;
      } else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') {
        i++;
      }
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    endRow();
  }
  return rows;
};
