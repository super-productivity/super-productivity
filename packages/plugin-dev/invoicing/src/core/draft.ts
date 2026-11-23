import { addDays, previousMonth, toDayStr } from './dates';
import { invoiceLanguage } from './invoice-labels';
import { buildDraftLines, DraftLine, sumBilled, TaskLike, toBilledMs } from './lines';
import { formatNumber, nextSeq } from './numbering';
import { Invoice, ProjectBilling, Settings } from './types';

/** What a draft is built from; `invoices` is sorted newest first. */
export interface DraftInput {
  settings: Settings;
  /** The app language; the default invoice language. */
  locale: string;
  invoices: Invoice[];
  projects: { id: string }[];
  tasks: TaskLike[];
}

export interface DraftLineState extends DraftLine {
  include: boolean;
  /** Hours from tracked time; `hours` differs once the user edits it. */
  autoHours: number;
}

/** The unsaved invoice the user is editing. */
export interface Draft {
  projectId: string;
  from: string;
  to: string;
  rate: number;
  client: string;
  /** Printed-invoice language code. */
  language: string;
  /** `null` until the user edits it: then it follows the next free number. */
  number: string | null;
  issueDate: string;
  lines: DraftLineState[];
}

/** The last invoiced project, unless it has since been deleted; else the first. */
export const initialProjectId = (input: DraftInput): string => {
  const last = input.invoices[0]?.projectId;
  return input.projects.some((p) => p.id === last)
    ? (last as string)
    : input.projects[0].id;
};

/** Rate, client and language remembered from the project's last invoice. */
export const projectDefaults = (
  input: Pick<DraftInput, 'settings' | 'locale'>,
  projectId: string,
): Required<ProjectBilling> => {
  const remembered = input.settings.projects[projectId];
  return {
    rate: remembered?.rate ?? 0,
    client: remembered?.client ?? '',
    language: invoiceLanguage(remembered?.language ?? input.locale),
  };
};

export const buildLines = (
  input: DraftInput,
  draft: Pick<Draft, 'projectId' | 'from' | 'to' | 'rate'>,
): DraftLineState[] =>
  buildDraftLines(input.tasks, {
    projectId: draft.projectId,
    period: { from: draft.from, to: draft.to },
    billed: sumBilled(input.invoices),
    rate: draft.rate,
    roundingMin: input.settings.roundingMin,
  }).map((line) => ({ ...line, include: true, autoHours: line.hours }));

export const newDraft = (input: DraftInput, today: Date): Draft => {
  const projectId = initialProjectId(input);
  const head = {
    projectId,
    ...previousMonth(today),
    ...projectDefaults(input, projectId),
    number: null,
    issueDate: toDayStr(today),
  };
  return { ...head, lines: buildLines(input, head) };
};

/**
 * The draft after the data reloads (settings saved, invoice deleted): lines
 * are rebuilt from tracked time, and a line that is still there keeps its
 * tick, title and, if the user changed them, its hours.
 */
export const resumeDraft = (
  input: DraftInput,
  prev: Draft | undefined,
  today: Date,
): Draft => {
  if (!prev || !input.projects.some((p) => p.id === prev.projectId)) {
    return newDraft(input, today);
  }
  const old = new Map(prev.lines.map((line) => [line.taskId, line]));
  const lines = buildLines(input, prev).map((line) => {
    const kept = old.get(line.taskId);
    if (!kept) return line;
    const hours = kept.hours !== kept.autoHours ? kept.hours : line.hours;
    return { ...line, include: kept.include, title: kept.title, hours };
  });
  return { ...prev, lines };
};

export const autoNumber = (input: DraftInput): string =>
  formatNumber(input.settings.numberPrefix, nextSeq(input.invoices));

const invoiceNumber = (input: DraftInput, draft: Draft): string =>
  (draft.number ?? autoNumber(input)).trim();

/** Why the draft cannot be issued yet, as a translation key; `null` if it can. */
export const issueBlocker = (input: DraftInput, draft: Draft): string | null => {
  if (!draft.from || !draft.to || draft.from > draft.to) return 'NEW.BLOCK.PERIOD';
  if (!draft.lines.some((line) => line.include && line.hours > 0)) {
    return 'NEW.BLOCK.LINES';
  }
  if (!(draft.rate > 0)) return 'NEW.BLOCK.RATE';
  const number = invoiceNumber(input, draft);
  if (!number) return 'NEW.BLOCK.NUMBER';
  if (input.invoices.some((invoice) => invoice.number === number)) {
    return 'NEW.BLOCK.NUMBER_USED';
  }
  if (!draft.issueDate) return 'NEW.BLOCK.DATE';
  return null;
};

export interface IssueOptions {
  input: DraftInput;
  draft: Draft;
  id: string;
}

/**
 * The frozen copy saved on issue. Ticked lines count as billed in full, even
 * when their hours were lowered (a write-off); lines lowered to 0 h are billed
 * but not printed.
 */
export const toInvoice = ({ input, draft, id }: IssueOptions): Invoice => {
  const included = draft.lines.filter((line) => line.include);
  const { settings } = input;
  return {
    id,
    seq: nextSeq(input.invoices),
    number: invoiceNumber(input, draft),
    projectId: draft.projectId,
    issueDate: draft.issueDate,
    dueDate: addDays(draft.issueDate, settings.paymentDays),
    periodFrom: draft.from,
    periodTo: draft.to,
    seller: settings.seller,
    client: draft.client,
    paymentNote: settings.paymentNote,
    currency: settings.currency,
    taxRatePct: settings.taxRatePct,
    lines: included
      .filter((line) => line.hours > 0)
      .map(({ title, hours }) => ({ title: title.trim(), hours, rate: draft.rate })),
    billedMs: toBilledMs(included),
    language: draft.language,
  };
};
