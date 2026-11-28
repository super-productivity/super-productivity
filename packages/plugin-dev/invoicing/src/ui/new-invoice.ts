import type { Project } from '@super-productivity/plugin-api';
import {
  autoNumber,
  buildLines,
  Draft,
  DraftInput,
  DraftLineState,
  issueBlocker,
  projectDefaults,
  resumeDraft,
  toInvoice,
} from '../core/draft';
import { INVOICE_LANGUAGES } from '../core/invoice-labels';
import { computeTotals } from '../core/totals';
import { Invoice } from '../core/types';
import { el, field, numberInput } from './dom';
import { createFormat, parseAmount } from './format';
import { t } from './i18n';
import { printInvoice } from './invoice-list';
import { snackError } from './notify';
import { saveInvoice, saveSettings } from './store';

export interface NewInvoiceData extends DraftInput {
  projects: Project[];
  locale: string;
}

// The page redraws after every save; keeping the draft here means saving your
// details or deleting an invoice does not throw away a half-finished invoice.
let current: Draft | undefined;

const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Remembers rate, client and language for the project, then prints. Runs only after the
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
      [draft.projectId]: {
        rate: draft.rate,
        client: draft.client,
        language: draft.language,
      },
    };
    await saveSettings({ ...data.settings, projects });
    printInvoice(invoice, data.locale);
  } catch (error) {
    snackError(error);
  }
};

interface IssueOptions {
  data: NewInvoiceData;
  draft: Draft;
  onIssued: (invoiceId: string) => void;
}

/** Saves and prints the invoice; resolves `false` if saving failed. */
const issue = async ({ data, draft, onIssued }: IssueOptions): Promise<boolean> => {
  const invoice = toInvoice({ input: data, draft, id: newId() });
  try {
    await saveInvoice(invoice);
  } catch (error) {
    snackError(error);
    return false;
  }
  current = undefined;
  await afterIssue(data, invoice, draft);
  onIssued(invoice.id);
  return true;
};

const lineRow = (line: DraftLineState, onEdit: () => void): HTMLTableRowElement => {
  const include = el('input', { type: 'checkbox', checked: line.include });
  const title = el('input', { value: line.title, className: 'grow' });
  const hours = numberInput(line.hours);
  // Name the line, so screen readers tell the rows apart.
  include.setAttribute('aria-label', `${t('NEW.INCLUDE')}: ${line.title}`);
  title.setAttribute('aria-label', t('INVOICE.DESCRIPTION'));
  hours.setAttribute('aria-label', `${t('INVOICE.HOURS')}: ${line.title}`);
  include.onchange = () => ((line.include = include.checked), onEdit());
  title.oninput = () => ((line.title = title.value), onEdit());
  hours.oninput = () => ((line.hours = parseAmount(hours.value)), onEdit());
  return el('tr', {}, [
    el('td', {}, [include]),
    el('td', {}, [title]),
    el('td', {}, [hours]),
  ]);
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

interface DraftEvents {
  /** Project or period changed: rebuild the lines. */
  redraft: () => void;
  /** Anything that changes the total or whether the draft can be issued. */
  update: () => void;
}

const draftInputs = (
  data: NewInvoiceData,
  draft: Draft,
  on: DraftEvents,
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
  const language = el(
    'select',
    {},
    Object.entries(INVOICE_LANGUAGES).map(([code, { name }]) =>
      el('option', { value: code, text: name, selected: code === draft.language }),
    ),
  );
  project.onchange = () => {
    Object.assign(draft, {
      projectId: project.value,
      ...projectDefaults(data, project.value),
    });
    rate.value = String(draft.rate);
    client.value = draft.client;
    language.value = draft.language;
    on.redraft();
  };
  from.onchange = () => ((draft.from = from.value), on.redraft());
  to.onchange = () => ((draft.to = to.value), on.redraft());
  rate.oninput = () => ((draft.rate = parseAmount(rate.value)), on.update());
  client.oninput = () => (draft.client = client.value);
  language.onchange = () => (draft.language = language.value);
  return [
    el('div', { className: 'row' }, [
      field(t('NEW.PROJECT'), project),
      field(t('NEW.FROM'), from),
      field(t('NEW.TO'), to),
    ]),
    el('div', { className: 'row' }, [
      field(t('NEW.RATE'), rate),
      field(t('NEW.LANGUAGE'), language),
    ]),
    field(t('NEW.CLIENT'), client, t('NEW.CLIENT_HINT')),
  ];
};

/** Number, date and the Issue button, which says why it is disabled. */
const issueControls = (
  data: NewInvoiceData,
  draft: Draft,
  onIssued: (invoiceId: string) => void,
): { update: () => void; nodes: HTMLElement[] } => {
  const number = el('input', { value: draft.number ?? autoNumber(data) });
  const issueDate = el('input', { type: 'date', value: draft.issueDate });
  const hint = el('p', { id: 'issue-hint', className: 'field-hint' });
  const button = el('button', { className: 'btn-primary', text: t('NEW.ISSUE') });
  button.setAttribute('aria-describedby', hint.id);
  // A disabled button cannot be focused, so announce the reason instead.
  hint.setAttribute('aria-live', 'polite');
  // Stays set once saved, so edits during printing cannot issue it twice.
  let busy = false;
  const update = (): void => {
    const blocker = issueBlocker(data, draft);
    button.disabled = busy || !!blocker;
    // Without lines the "no unbilled time" callout already says why, unless
    // the period itself is wrong.
    const show = draft.lines.length || blocker === 'NEW.BLOCK.PERIOD';
    hint.textContent = blocker && show ? t(blocker) : '';
  };
  number.oninput = () => ((draft.number = number.value), update());
  issueDate.oninput = () => ((draft.issueDate = issueDate.value), update());
  button.onclick = async () => {
    busy = true;
    update();
    busy = await issue({ data, draft, onIssued });
    if (!busy) (update(), button.focus());
  };
  return {
    update,
    nodes: [
      el('div', { className: 'row' }, [
        field(t('NEW.NUMBER'), number),
        field(t('NEW.ISSUE_DATE'), issueDate),
      ]),
      el('div', { className: 'actions' }, [hint, button]),
    ],
  };
};

/** The draft form: project + period → unbilled lines → issue. */
export const renderNewInvoice = (
  data: NewInvoiceData,
  onIssued: (invoiceId: string) => void,
): HTMLElement => {
  const section = el('section', { className: 'stack' });
  if (!data.projects.length) {
    section.append(el('p', { className: 'text-muted', text: t('NEW.NO_PROJECTS') }));
    return section;
  }
  const draft = (current = resumeDraft(data, current, new Date()));
  const fmt = createFormat(data.locale, data.settings.currency);
  const total = el('p', { className: 'text-primary' });
  const lines = el('div');
  const controls = issueControls(data, draft, onIssued);
  const update = (): void => {
    const included = draft.lines.filter((l) => l.include);
    const priced = included.map((l) => ({ ...l, rate: draft.rate }));
    const totals = computeTotals(priced, data.settings.taxRatePct);
    total.textContent = `${t('INVOICE.TOTAL')}: ${fmt.money(totals.totalCents)}`;
    controls.update();
  };
  const showLines = (): void => (
    lines.replaceChildren(linesTable(draft, update)),
    update()
  );
  const redraft = (): void => ((draft.lines = buildLines(data, draft)), showLines());
  section.append(
    ...draftInputs(data, draft, { redraft, update }),
    lines,
    total,
    ...controls.nodes,
  );
  showLines();
  return section;
};
