import { InvoiceFormat } from '../core/invoice-html';
import { invoiceLabels, invoiceLanguage } from '../core/invoice-labels';

const toDate = (dayStr: string): Date => {
  const [y, m, d] = dayStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Labels and money, date and hours formats in `locale`; unknown currency codes print as text. */
export const createFormat = (locale: string, currency: string): InvoiceFormat => {
  let money: (cents: number) => string;
  try {
    const nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
    money = (cents) => nf.format(cents / 100);
  } catch {
    // Intl throws RangeError on an invalid code; show the code the user typed.
    money = (cents) => `${(cents / 100).toFixed(2)} ${currency}`;
  }
  const df = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const hf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return {
    money,
    date: (dayStr) => (dayStr ? df.format(toDate(dayStr)) : ''),
    hours: (hours) => hf.format(hours),
    lang: invoiceLanguage(locale),
    labels: invoiceLabels(locale),
  };
};
