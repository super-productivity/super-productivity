import { createFormat } from './format';

describe('createFormat', () => {
  it('formats the tax rate in the invoice language', () => {
    expect(createFormat('de', 'EUR').percent(7.5)).toBe('7,5 %');
    expect(createFormat('en', 'EUR').percent(19)).toBe('19%');
  });

  it('labels in the invoice language', () => {
    expect(createFormat('fr', 'EUR').labels.invoice).toBe('Facture');
  });
});
