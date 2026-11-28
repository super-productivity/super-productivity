import { invoiceToCsv } from '../core/csv';
import { invoiceTitle, renderInvoiceHtml } from '../core/invoice-html';
import { computeTotals } from '../core/totals';
import { Invoice } from '../core/types';
import { el } from './dom';
import { createFormat } from './format';
import { t } from './i18n';
import { snackError } from './notify';
import { deleteInvoice, sendToBackground } from './store';

/**
 * Runs `print` with this frame and the app window titled `title`: print
 * dialogs suggest it as the PDF file name, Chromium from the app window,
 * Firefox from the printed frame. print() blocks until the dialog closes.
 */
const printWithWindowTitle = (title: string, print: () => void): void => {
  const docs = [document];
  try {
    if (window.top && window.top !== window) docs.push(window.top.document);
  } catch (error) {
    // Only if the host stops sharing its origin with the plugin frame: print
    // with the frame's title rather than not at all.
    console.warn('Invoicing: cannot set the PDF file name', error);
  }
  const previous = docs.map((doc) => doc.title);
  docs.forEach((doc) => (doc.title = title));
  try {
    print();
  } finally {
    docs.forEach((doc, i) => (doc.title = previous[i]));
  }
};

/**
 * Puts the invoice into the print-only container and opens the print dialog.
 * Invoices from before the language choice print in the app language.
 */
export const printInvoice = (invoice: Invoice, appLocale: string): void => {
  const root = document.getElementById('print-root') as HTMLElement;
  const fmt = createFormat(invoice.language ?? appLocale, invoice.currency);
  // renderInvoiceHtml escapes all user text.
  root.innerHTML = renderInvoiceHtml(invoice, fmt);
  printWithWindowTitle(invoiceTitle(invoice, fmt.labels), () => window.print());
};

const downloadCsv = (invoice: Invoice): Promise<unknown> =>
  sendToBackground({
    type: 'download',
    filename: `invoice-${invoice.number.replace(/[^\w.-]+/g, '_')}.csv`,
    // BOM: without it Excel reads the UTF-8 file as Latin-1 and garbles accents.
    data: '\ufeff' + invoiceToCsv(invoice),
  });

const invoiceRow = (
  invoice: Invoice,
  locale: string,
  onChange: () => void,
): HTMLLIElement => {
  const fmt = createFormat(locale, invoice.currency);
  const total = fmt.money(computeTotals(invoice.lines, invoice.taxRatePct).totalCents);
  const client = invoice.client.split('\n')[0];
  const remove = async (): Promise<void> => {
    if (!window.confirm(t('LIST.CONFIRM_DELETE', { number: invoice.number }))) return;
    try {
      await deleteInvoice(invoice.id);
      onChange();
    } catch (error) {
      snackError(error);
    }
  };
  const summaryId = `inv-${invoice.id}`;
  // Each row repeats the same button names; the description says which invoice.
  const button = (props: Partial<HTMLButtonElement> & { text: string }): HTMLElement => {
    const node = el('button', props);
    node.setAttribute('aria-describedby', summaryId);
    return node;
  };
  const row = el('li', { className: 'list-item' }, [
    el('span', {
      id: summaryId,
      className: 'grow',
      text: [invoice.number, fmt.date(invoice.issueDate), client, total]
        .filter(Boolean)
        .join(' · '),
    }),
    button({ text: t('LIST.PRINT'), onclick: () => printInvoice(invoice, locale) }),
    button({
      text: t('LIST.CSV'),
      onclick: () => downloadCsv(invoice).catch(snackError),
    }),
    button({ className: 'btn-text btn-danger', text: t('LIST.DELETE'), onclick: remove }),
  ]);
  row.dataset.invoiceId = invoice.id;
  return row;
};

export const renderInvoiceList = (
  invoices: Invoice[],
  locale: string,
  onChange: () => void,
): HTMLElement =>
  invoices.length
    ? el(
        'ul',
        { className: 'list' },
        invoices.map((inv) => invoiceRow(inv, locale, onChange)),
      )
    : el('p', { className: 'text-muted', text: t('LIST.EMPTY') });
