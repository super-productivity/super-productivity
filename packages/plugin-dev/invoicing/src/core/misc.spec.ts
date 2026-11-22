import { invoiceToCsv } from './csv';
import { addDays, previousMonth } from './dates';
import { formatNumber, nextSeq } from './numbering';
import { parseSettings } from './settings';
import { Invoice } from './types';

describe('previousMonth', () => {
  it('returns the whole previous month, across a year boundary', () => {
    expect(previousMonth(new Date(2026, 0, 15))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(previousMonth(new Date(2024, 2, 1))).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });
});

describe('addDays', () => {
  it('crosses month ends', () => {
    expect(addDays('2026-11-20', 14)).toBe('2026-12-04');
  });
});

describe('numbering', () => {
  it('continues after the highest issued number', () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([{ seq: 3 }, { seq: 7 }] as Invoice[])).toBe(8);
    expect(formatNumber('2026-', 8)).toBe('2026-008');
  });
});

describe('parseSettings', () => {
  it('fills missing fields with defaults', () => {
    const settings = parseSettings('{"currency":"USD"}');
    expect(settings.currency).toBe('USD');
    expect(settings.paymentDays).toBe(14);
    expect(settings.projects).toEqual({});
  });
});

describe('invoiceToCsv', () => {
  it('writes one quoted, formula-safe row per line', () => {
    const invoice = {
      number: '001',
      issueDate: '2026-11-01',
      currency: 'EUR',
      lines: [
        { title: 'Design, "v2"', hours: 1.5, rate: 80 },
        { title: '=SUM(A1)', hours: 1, rate: 80 },
        { title: '\t=1+1', hours: 1, rate: 80 },
      ],
    } as Invoice;
    expect(invoiceToCsv(invoice)).toBe(
      'Invoice,Date,Description,Hours,Rate,Amount,Currency\n' +
        '001,2026-11-01,"Design, ""v2""",1.50,80.00,120.00,EUR\n' +
        "001,2026-11-01,'=SUM(A1),1.00,80.00,80.00,EUR\n" +
        "001,2026-11-01,'\t=1+1,1.00,80.00,80.00,EUR\n",
    );
  });
});
