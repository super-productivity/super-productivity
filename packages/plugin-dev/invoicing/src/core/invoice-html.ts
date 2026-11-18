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
  money: (cents: number) => string;
  date: (dayStr: string) => string;
  hours: (hours: number) => string;
  labels: InvoiceLabels;
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Multi-line free text (addresses, bank details) keeps its line breaks. */
const block = (text: string): string =>
  text.trim() ? `<p class="inv-block">${escapeHtml(text.trim())}</p>` : '';

const metaRow = (label: string, value: string): string =>
  `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;

/** The printable invoice. All user text is escaped. */
export const renderInvoiceHtml = (invoice: Invoice, fmt: InvoiceFormat): string => {
  const { labels: l, money, date } = fmt;
  const totals = computeTotals(invoice.lines, invoice.taxRatePct);
  const lines = invoice.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.title)}</td><td class="num">${fmt.hours(line.hours)}</td>` +
        `<td class="num">${money(Math.round(line.rate * 100))}</td>` +
        `<td class="num">${money(lineCents(line))}</td></tr>`,
    )
    .join('');
  const taxRow =
    invoice.taxRatePct > 0
      ? `<tr><td colspan="3">${escapeHtml(l.tax)} ${invoice.taxRatePct}%</td>` +
        `<td class="num">${money(totals.taxCents)}</td></tr>`
      : '';
  return (
    `<article class="inv">
  ${block(invoice.seller)}
  <h1>${escapeHtml(l.invoice)}</h1>
  <table class="inv-meta">
    ${metaRow(l.number, invoice.number)}
    ${metaRow(l.issueDate, date(invoice.issueDate))}
    ${metaRow(l.dueDate, date(invoice.dueDate))}
    ${metaRow(l.period, `${date(invoice.periodFrom)} – ${date(invoice.periodTo)}`)}
  </table>
  <h2>${escapeHtml(l.billTo)}</h2>
  ${block(invoice.client)}
  <table class="inv-lines">
    <thead><tr><th>${escapeHtml(l.description)}</th><th class="num">${escapeHtml(l.hours)}</th>` +
    `<th class="num">${escapeHtml(l.rate)}</th><th class="num">${escapeHtml(l.amount)}</th></tr></thead>
    <tbody>${lines}</tbody>
    <tfoot>
      <tr><td colspan="3">${escapeHtml(l.subtotal)}</td><td class="num">${money(totals.subtotalCents)}</td></tr>
      ${taxRow}
      <tr class="inv-total"><td colspan="3">${escapeHtml(l.total)}</td><td class="num">${money(totals.totalCents)}</td></tr>
    </tfoot>
  </table>
  ${block(invoice.paymentNote)}
</article>`
  );
};
