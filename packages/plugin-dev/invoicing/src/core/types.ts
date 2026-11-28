/** Per-project billing defaults, remembered from the last invoice. */
export interface ProjectBilling {
  rate: number;
  client: string;
  /** Printed-invoice language code; missing in older data → app language. */
  language?: string;
}

/** Saved under the `settings` key; every field may be missing in older data. */
export interface Settings {
  /** Free text block: name, address, tax ID — printed as the sender. */
  seller: string;
  /** Free text block: bank details, payment terms — printed at the bottom. */
  paymentNote: string;
  currency: string;
  taxRatePct: number;
  paymentDays: number;
  /** Round each line's time up to this many minutes; 0 = exact. */
  roundingMin: number;
  numberPrefix: string;
  projects: Record<string, ProjectBilling>;
}

export interface InvoiceLine {
  title: string;
  hours: number;
  rate: number;
}

/** Tracked milliseconds per task id and day (`YYYY-MM-DD`). */
export type MsByTaskDay = Record<string, Record<string, number>>;

/** An issued invoice. A frozen copy: later time edits never change it. */
export interface Invoice {
  id: string;
  seq: number;
  number: string;
  projectId: string;
  issueDate: string;
  dueDate: string;
  periodFrom: string;
  periodTo: string;
  seller: string;
  client: string;
  paymentNote: string;
  currency: string;
  taxRatePct: number;
  lines: InvoiceLine[];
  /** The tracked time this invoice billed; subtracted from later drafts. */
  billedMs: MsByTaskDay;
  /** Printed-invoice language code; missing in older invoices → app language. */
  language?: string;
}

export interface Period {
  from: string;
  to: string;
}
