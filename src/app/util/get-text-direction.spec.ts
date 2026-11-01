import { getTextDirection } from './get-text-direction';

describe('getTextDirection', () => {
  for (const text of [
    'متن فارسی',
    'Docker را بررسی کن',
    'Review گزارش',
    'A ع',
    'x ﭖ',
    'Check العربية',
  ]) {
    it(`uses RTL for any Persian/Arabic letter in ${text}`, () => {
      expect(getTextDirection(text)).toBe('rtl');
    });
  }
  for (const text of [
    undefined,
    null,
    '',
    'English only',
    '123',
    '۱۲۳',
    '١٢٣',
    '،؟',
    '\u064e',
    'עברית',
    '中文',
  ]) {
    it(`uses LTR without Persian/Arabic letters: ${text}`, () => {
      expect(getTextDirection(text)).toBe('ltr');
    });
  }
});
