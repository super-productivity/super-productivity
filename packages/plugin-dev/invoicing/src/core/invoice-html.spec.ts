import { invoiceTitle, renderInvoiceHtml } from './invoice-html';
import { Invoice } from './types';

const labels = {
  invoice: 'Invoice',
  number: 'No.',
  issueDate: 'Date',
  dueDate: 'Due',
  period: 'Period',
  billTo: 'Bill to',
  description: 'Description',
  hours: 'Hours',
  rate: 'Rate',
  amount: 'Amount',
  subtotal: 'Subtotal',
  tax: 'VAT',
  total: 'Total',
};

const invoice: Invoice = {
  id: 'i1',
  seq: 1,
  number: '001',
  projectId: 'p1',
  issueDate: '2026-11-01',
  dueDate: '2026-11-15',
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
  seller: 'Me <script>',
  client: 'ACME',
  paymentNote: '',
  currency: 'EUR',
  taxRatePct: 0,
  lines: [{ title: 'A & B', hours: 2, rate: 50 }],
  billedMs: {},
};

const render = (inv: Invoice, lang = 'en'): string =>
  renderInvoiceHtml(inv, {
    lang,
    money: (cents) => (cents / 100).toFixed(2),
    date: (d) => d,
    hours: (h) => h.toFixed(2),
    percent: (p) => `${p} pct`,
    labels,
  });

describe('renderInvoiceHtml', () => {
  it('escapes user text and shows the total', () => {
    const html = render(invoice);
    expect(html).toContain('Me &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('A &amp; B');
    expect(html).toMatch(/Total<\/td><td class="num">100\.00/);
  });

  it('escapes formatted values too: an unknown currency code prints as typed', () => {
    const html = renderInvoiceHtml(invoice, {
      lang: 'en',
      money: (cents) => `${(cents / 100).toFixed(2)} <b>`,
      date: (d) => d,
      hours: (h) => h.toFixed(2),
      percent: (p) => `${p} pct`,
      labels,
    });
    expect(html).not.toContain('<b>');
    expect(html).toContain('100.00 &lt;b&gt;');
  });

  it('shows subtotal and tax lines only when tax is set', () => {
    expect(render(invoice)).not.toMatch(/VAT|Subtotal/);
    expect(render({ ...invoice, taxRatePct: 20 })).toMatch(
      /Subtotal.*100\.00.*VAT 20 pct.*20\.00.*Total.*120\.00/s,
    );
  });

  it('keeps the totals out of tfoot, which browsers repeat on every printed page', () => {
    expect(render(invoice)).not.toContain('<tfoot');
  });

  it('leaves out "Bill to" without a client', () => {
    expect(render({ ...invoice, client: ' ' })).not.toContain('Bill to');
  });

  it('lets right-to-left text pick its own direction', () => {
    expect(
      render({ ...invoice, lines: [{ title: 'تصميم', hours: 1, rate: 1 }] }),
    ).toContain('<td dir="auto">تصميم</td>');
  });

  it('marks the language and lays out Arabic and Persian invoices right to left', () => {
    expect(render(invoice, 'de')).toContain('lang="de" dir="ltr"');
    expect(render(invoice, 'ar')).toContain('lang="ar" dir="rtl"');
  });
});

describe('invoiceTitle', () => {
  it('names the invoice and the first line of the client', () => {
    expect(invoiceTitle({ ...invoice, client: ' ACME Ltd\n1 Main St' }, labels)).toBe(
      'Invoice 001 - ACME Ltd',
    );
  });

  it('leaves out an empty client', () => {
    expect(invoiceTitle({ ...invoice, client: '' }, labels)).toBe('Invoice 001');
  });
});
