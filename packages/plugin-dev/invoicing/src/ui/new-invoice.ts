import type { Project } from '@super-productivity/plugin-api';
import { addDays, previousMonth, toDayStr } from '../core/dates';
import {
  buildDraftLines,
  DraftLine,
  sumBilled,
  TaskLike,
  toBilledMs,
} from '../core/lines';
import { formatNumber, nextSeq } from '../core/numbering';
import { computeTotals } from '../core/totals';
import { Invoice, Settings } from '../core/types';
import { el, field, numberInput } from './dom';
import { createFormat } from './format';
import { t } from './i18n';
import { printInvoice } from './invoice-list';
import { snackError } from './notify';
import { saveInvoice, saveSettings } from './store';

export interface NewInvoiceData {
  settings: Settings;
  invoices: Invoice[];
  projects: Project[];
  tasks: TaskLike[];
  locale: string;
}

interface Draft {
  projectId: string;
  from: string;
  to: string;
  rate: number;
  client: string;
  lines: (DraftLine & { include: boolean })[];
}

const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const buildLines = (data: NewInvoiceData, draft: Draft): Draft['lines'] =>
  buildDraftLines(data.tasks, {
    projectId: draft.projectId,
    period: { from: draft.from, to: draft.to },
    billed: sumBilled(data.invoices),
    rate: draft.rate,
    roundingMin: data.settings.roundingMin,
  }).map((line) => ({ ...line, include: true }));

const initialDraft = (data: NewInvoiceData): Draft => {
  // The last invoiced project may since have been deleted.
  const last = data.invoices[0]?.projectId;
  const projectId = data.projects.some((p) => p.id === last)
    ? (last as string)
    : data.projects[0].id;
  const billing = data.settings.projects[projectId];
  const draft: Draft = {
    projectId,
    ...previousMonth(new Date()),
    rate: billing?.rate ?? 0,
    client: billing?.client ?? '',
    lines: [],
  };
  return { ...draft, lines: buildLines(data, draft) };
};

const toInvoice = (
  data: NewInvoiceData,
  draft: Draft,
  number: string,
  issueDate: string,
): Invoice => {
  const included = draft.lines.filter((line) => line.include);
  const { settings } = data;
  return {
    id: newId(),
    seq: nextSeq(data.invoices),
    number,
    projectId: draft.projectId,
    issueDate,
    dueDate: addDays(issueDate, settings.paymentDays),
    periodFrom: draft.from,
    periodTo: draft.to,
    seller: settings.seller,
    client: draft.client,
    paymentNote: settings.paymentNote,
    currency: settings.currency,
    taxRatePct: settings.taxRatePct,
    lines: included.map(({ title, hours }) => ({ title, hours, rate: draft.rate })),
    billedMs: toBilledMs(included),
  };
};

/**
 * Remembers rate and client for the project, then prints. Runs only after the
 * invoice is saved, so a failure here must not offer a retry: that would issue
 * the same hours twice.
 */
const afterIssue = async (
  data: NewInvoiceData,
  invoice: Invoice,
  draft: Draft,
): Promise<void> => {
  try {
    const projects = {
      ...data.settings.projects,
      [draft.projectId]: { rate: draft.rate, client: draft.client },
    };
    await saveSettings({ ...data.settings, projects });
    printInvoice(invoice, data.locale);
  } catch (error) {
    snackError(error);
  }
};

const lineRow = (
  line: Draft['lines'][number],
  onEdit: () => void,
): HTMLTableRowElement => {
  const include = el('input', { type: 'checkbox', checked: line.include });
  const title = el('input', { value: line.title, className: 'grow' });
  const hours = numberInput(line.hours);
  include.onchange = () => ((line.include = include.checked), onEdit());
  title.oninput = () => ((line.title = title.value), onEdit());
  hours.oninput = () => ((line.hours = Number(hours.value) || 0), onEdit());
  include.ariaLabel = t('NEW.INCLUDE');
  return el('tr', {}, [
    el('td', {}, [include]),
    el('td', {}, [title]),
    el('td', {}, [hours]),
  ]);
};

/** The draft form: project + period → unbilled lines → issue. */
export const renderNewInvoice = (
  data: NewInvoiceData,
  onIssued: () => void,
): HTMLElement => {
  const section = el('section', { className: 'stack' });
  if (!data.projects.length) {
    section.append(el('p', { className: 'text-muted', text: t('NEW.NO_PROJECTS') }));
    return section;
  }
  const draft = initialDraft(data);
  const paint = (): void =>
    section.replaceChildren(...renderDraft(data, draft, paint, onIssued));
  paint();
  return section;
};

const renderDraft = (
  data: NewInvoiceData,
  draft: Draft,
  repaint: () => void,
  onIssued: () => void,
): HTMLElement[] => {
  const fmt = createFormat(data.locale, data.settings.currency);
  const total = el('p', { className: 'text-primary' });
  const number = el('input', {
    value: formatNumber(data.settings.numberPrefix, nextSeq(data.invoices)),
  });
  const issueDate = el('input', { type: 'date', value: toDayStr(new Date()) });
  const issueBtn = el('button', { className: 'btn-primary', text: t('NEW.ISSUE') });
  const update = (): void => {
    const included = draft.lines.filter((l) => l.include);
    const lines = included.map((l) => ({ ...l, rate: draft.rate }));
    const totals = computeTotals(lines, data.settings.taxRatePct);
    total.textContent = `${t('INVOICE.TOTAL')}: ${fmt.money(totals.totalCents)}`;
    issueBtn.disabled =
      !included.length ||
      !number.value.trim() ||
      !issueDate.value ||
      !draft.from ||
      !draft.to;
  };
  number.oninput = update;
  issueDate.oninput = update;
  issueBtn.onclick = async () => {
    issueBtn.disabled = true;
    const invoice = toInvoice(data, draft, number.value.trim(), issueDate.value);
    try {
      await saveInvoice(invoice);
    } catch (error) {
      snackError(error);
      issueBtn.disabled = false;
      return;
    }
    await afterIssue(data, invoice, draft);
    onIssued();
  };
  update();
  return [
    ...draftInputs(data, draft, repaint, update),
    linesTable(draft, update),
    total,
    el('div', { className: 'row' }, [
      field(t('NEW.NUMBER'), number),
      field(t('NEW.ISSUE_DATE'), issueDate),
    ]),
    el('div', { className: 'actions' }, [issueBtn]),
  ];
};

const linesTable = (draft: Draft, onEdit: () => void): HTMLElement =>
  draft.lines.length
    ? el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: t('NEW.INCLUDE') }),
            el('th', { text: t('INVOICE.DESCRIPTION') }),
            el('th', { text: t('INVOICE.HOURS') }),
          ]),
        ]),
        el(
          'tbody',
          {},
          draft.lines.map((line) => lineRow(line, onEdit)),
        ),
      ])
    : el('p', { className: 'callout', text: t('NEW.NO_HOURS') });

const draftInputs = (
  data: NewInvoiceData,
  draft: Draft,
  repaint: () => void,
  update: () => void,
): HTMLElement[] => {
  const project = el(
    'select',
    {},
    data.projects.map((p) =>
      el('option', { value: p.id, text: p.title, selected: p.id === draft.projectId }),
    ),
  );
  const from = el('input', { type: 'date', value: draft.from });
  const to = el('input', { type: 'date', value: draft.to });
  const rate = numberInput(draft.rate);
  const client = el('textarea', { rows: 3, value: draft.client });
  const redraft = (): void => {
    draft.from = from.value;
    draft.to = to.value;
    draft.lines = buildLines(data, draft);
    repaint();
  };
  project.onchange = () => {
    const billing = data.settings.projects[project.value];
    Object.assign(draft, {
      projectId: project.value,
      rate: billing?.rate ?? 0,
      client: billing?.client ?? '',
    });
    redraft();
  };
  from.onchange = redraft;
  to.onchange = redraft;
  rate.oninput = () => ((draft.rate = Number(rate.value) || 0), update());
  client.oninput = () => (draft.client = client.value);
  return [
    el('div', { className: 'row' }, [
      field(t('NEW.PROJECT'), project),
      field(t('NEW.FROM'), from),
      field(t('NEW.TO'), to),
    ]),
    el('div', { className: 'row' }, [field(t('NEW.RATE'), rate)]),
    field(t('NEW.CLIENT'), client, t('NEW.CLIENT_HINT')),
  ];
};
