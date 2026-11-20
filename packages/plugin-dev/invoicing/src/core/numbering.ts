import { Invoice } from './types';

/**
 * Next sequence number, derived from the issued invoices rather than a stored
 * counter: a counter in the synced settings could be overwritten when two
 * devices issue invoices before syncing.
 */
export const nextSeq = (invoices: Invoice[]): number =>
  invoices.reduce((max, invoice) => Math.max(max, invoice.seq), 0) + 1;

export const formatNumber = (prefix: string, seq: number): string =>
  `${prefix}${String(seq).padStart(3, '0')}`;
