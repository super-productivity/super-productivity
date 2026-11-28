import { InvoiceLine } from './types';

export interface Totals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** Amounts in cents, so the printed lines always add up to the printed total. */
export const lineCents = (line: InvoiceLine): number =>
  Math.round(line.hours * line.rate * 100);

export const computeTotals = (lines: InvoiceLine[], taxRatePct: number): Totals => {
  const subtotalCents = lines.reduce((sum, line) => sum + lineCents(line), 0);
  const taxCents = Math.round((subtotalCents * taxRatePct) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
};
