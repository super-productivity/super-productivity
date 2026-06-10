import { nextYearOf, prevYearOf } from './year-nav.util';

describe('year-nav util (years sorted newest-first)', () => {
  const years = [2026, 2024, 2023];

  it('prevYearOf walks toward older years and stops at the oldest', () => {
    expect(prevYearOf(years, 2026)).toBe(2024);
    expect(prevYearOf(years, 2024)).toBe(2023);
    expect(prevYearOf(years, 2023)).toBeNull();
  });

  it('nextYearOf walks toward newer years and stops at the newest', () => {
    expect(nextYearOf(years, 2023)).toBe(2024);
    expect(nextYearOf(years, 2024)).toBe(2026);
    expect(nextYearOf(years, 2026)).toBeNull();
  });

  it('returns null when the selected year is not in the list', () => {
    expect(prevYearOf(years, 2025)).toBeNull();
    expect(nextYearOf(years, 2025)).toBeNull();
    expect(prevYearOf([], 2026)).toBeNull();
    expect(nextYearOf([], 2026)).toBeNull();
  });
});
