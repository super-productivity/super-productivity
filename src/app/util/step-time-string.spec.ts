import { stepTimeString } from './step-time-string';

describe('stepTimeString', () => {
  it('increments by 1 minute', () => {
    expect(stepTimeString('09:00', 1)).toBe('09:01');
  });

  it('decrements by 1 minute', () => {
    expect(stepTimeString('09:01', -1)).toBe('09:00');
  });

  it('increments by 5 minutes', () => {
    expect(stepTimeString('09:00', 5)).toBe('09:05');
  });

  it('increments by 15 minutes', () => {
    expect(stepTimeString('09:00', 15)).toBe('09:15');
  });

  it('wraps past midnight', () => {
    expect(stepTimeString('23:55', 10)).toBe('00:05');
  });

  it('wraps before midnight', () => {
    expect(stepTimeString('00:03', -5)).toBe('23:58');
  });

  it('handles exactly 00:00 incremented', () => {
    expect(stepTimeString('00:00', 5)).toBe('00:05');
  });

  it('handles exactly 23:59 incremented', () => {
    expect(stepTimeString('23:59', 1)).toBe('00:00');
  });

  it('handles large step values', () => {
    expect(stepTimeString('01:00', 120)).toBe('03:00');
  });

  it('returns null for empty string', () => {
    expect(stepTimeString('', 5)).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(stepTimeString('ab:cd', 5)).toBeNull();
  });

  it('returns null for out-of-range hours', () => {
    expect(stepTimeString('25:00', 5)).toBeNull();
  });

  it('returns null for out-of-range minutes', () => {
    expect(stepTimeString('09:60', 5)).toBeNull();
  });
});
