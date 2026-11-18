import { lineCents } from './totals';
import { Invoice } from './types';

const cell = (value: string | number): string => {
  const text = String(value);
  // Quote when needed; a leading =,+,-,@, tab or CR can run as a formula in spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One row per invoice line, for importing into accounting tools. */
export const invoiceToCsv = (invoice: Invoice): string => {
  const header = [
    'Invoice',
    'Date',
    'Description',
    'Hours',
    'Rate',
    'Amount',
    'Currency',
  ];
  const rows = invoice.lines.map((line) => [
    invoice.number,
    invoice.issueDate,
    line.title,
    line.hours.toFixed(2),
    line.rate.toFixed(2),
    (lineCents(line) / 100).toFixed(2),
    invoice.currency,
  ]);
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n';
};
