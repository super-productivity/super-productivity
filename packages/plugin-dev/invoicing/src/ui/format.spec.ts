import { createFormat, parseAmount } from './format';

describe('createFormat', () => {
  it('formats the tax rate in the invoice language', () => {
    expect(createFormat('de', 'EUR').percent(7.5)).toBe('7,5 %');
    expect(createFormat('en', 'EUR').percent(19)).toBe('19%');
  });

  it('labels in the invoice language', () => {
    expect(createFormat('fr', 'EUR').labels.invoice).toBe('Facture');
  });
});

describe('parseAmount', () => {
  it('keeps two decimals, as printed, so hours × rate matches the amount', () => {
    expect(parseAmount('1.234')).toBe(1.23);
    expect(parseAmount('33.336')).toBe(33.34);
  });

  it('reads an empty or invalid field as 0', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });
});
