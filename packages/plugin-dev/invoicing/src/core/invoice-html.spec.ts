import { renderInvoiceHtml } from './invoice-html';
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

const render = (inv: Invoice): string =>
  renderInvoiceHtml(inv, {
    money: (cents) => (cents / 100).toFixed(2),
    date: (d) => d,
    hours: (h) => h.toFixed(2),
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

  it('shows the tax line only when tax is set', () => {
    expect(render(invoice)).not.toContain('VAT');
    expect(render({ ...invoice, taxRatePct: 20 })).toMatch(/VAT 20%.*20\.00/);
  });
});
