import { computeTotals, lineCents } from './totals';
import { Invoice } from './types';

export interface InvoiceLabels {
  invoice: string;
  number: string;
  issueDate: string;
  dueDate: string;
  period: string;
  billTo: string;
  description: string;
  hours: string;
  rate: string;
  amount: string;
  subtotal: string;
  tax: string;
  total: string;
}

export interface InvoiceFormat {
  /** Language code of the labels, for `lang`/`dir` on the printed page. */
  lang: string;
  money: (cents: number) => string;
  date: (dayStr: string) => string;
  hours: (hours: number) => string;
  percent: (pct: number) => string;
  labels: InvoiceLabels;
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Multi-line free text (addresses, bank details) keeps its line breaks.
 * `dir="auto"` lays out Arabic or Hebrew text right to left.
 */
const block = (text: string, className: string): string =>
  text.trim() ? `<p class="${className}" dir="auto">${escapeHtml(text.trim())}</p>` : '';

const metaRow = (label: string, value: string): string =>
  `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;

const sumRow = (label: string, amount: string, className = ''): string =>
  `<tr class="${className}"><td colspan="3">${escapeHtml(label)}</td>` +
  `<td class="num">${escapeHtml(amount)}</td></tr>`;

const lineRows = (invoice: Invoice, fmt: InvoiceFormat): string =>
  invoice.lines
    .map(
      (line) =>
        `<tr><td dir="auto">${escapeHtml(line.title)}</td>` +
        `<td class="num">${escapeHtml(fmt.hours(line.hours))}</td>` +
        `<td class="num">${escapeHtml(fmt.money(Math.round(line.rate * 100)))}</td>` +
        `<td class="num">${escapeHtml(fmt.money(lineCents(line)))}</td></tr>`,
    )
    .join('');

/**
 * Subtotal and tax only when there is tax; else the total says it all. A
 * second tbody rather than tfoot: browsers repeat tfoot on every printed page.
 */
const sumRows = (invoice: Invoice, fmt: InvoiceFormat): string => {
  const { labels: l, money } = fmt;
  const totals = computeTotals(invoice.lines, invoice.taxRatePct);
  const tax =
    invoice.taxRatePct > 0
      ? sumRow(l.subtotal, money(totals.subtotalCents)) +
        sumRow(`${l.tax} ${fmt.percent(invoice.taxRatePct)}`, money(totals.taxCents))
      : '';
  return tax + sumRow(l.total, money(totals.totalCents), 'inv-total');
};

const billTo = (invoice: Invoice, label: string): string =>
  invoice.client.trim()
    ? `<div><h2>${escapeHtml(label)}</h2>${block(invoice.client, 'inv-address')}</div>`
    : '<div></div>';

/** The suggested PDF file name: number and the first line of the client. */
export const invoiceTitle = (invoice: Invoice, labels: InvoiceLabels): string => {
  const client = invoice.client.trim().split('\n')[0].trim();
  return [`${labels.invoice} ${invoice.number}`, client].filter(Boolean).join(' - ');
};

const RTL = ['ar', 'fa'];

/**
 * The printable invoice. All text is escaped, formatted values too: an unknown
 * currency code prints as typed.
 */
export const renderInvoiceHtml = (invoice: Invoice, fmt: InvoiceFormat): string => {
  const { labels: l, date } = fmt;
  const th = (label: string, className = ''): string =>
    `<th scope="col" class="${className}">${escapeHtml(label)}</th>`;
  const dir = RTL.includes(fmt.lang) ? 'rtl' : 'ltr';
  return `<article class="inv" lang="${escapeHtml(fmt.lang)}" dir="${dir}">
  <header class="inv-head">
    <h1>${escapeHtml(l.invoice)}</h1>
    ${block(invoice.seller, 'inv-address')}
  </header>
  <div class="inv-head">
    ${billTo(invoice, l.billTo)}
    <table class="inv-meta">
      ${metaRow(l.number, invoice.number)}
      ${metaRow(l.issueDate, date(invoice.issueDate))}
      ${metaRow(l.dueDate, date(invoice.dueDate))}
      ${metaRow(l.period, `${date(invoice.periodFrom)} – ${date(invoice.periodTo)}`)}
    </table>
  </div>
  <table class="inv-lines">
    <thead><tr>${th(l.description)}${th(l.hours, 'num')}${th(l.rate, 'num')}${th(l.amount, 'num')}</tr></thead>
    <tbody>${lineRows(invoice, fmt)}</tbody>
    <tbody class="inv-sum">${sumRows(invoice, fmt)}</tbody>
  </table>
  ${block(invoice.paymentNote, 'inv-note')}
</article>`;
};
