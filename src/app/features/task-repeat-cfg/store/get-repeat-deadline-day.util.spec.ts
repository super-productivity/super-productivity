import {
  getDeadlineOffsetDays,
  getRepeatDeadlineDay,
} from './get-repeat-deadline-day.util';

describe('getRepeatDeadlineDay', () => {
  it('should return undefined without an offset', () => {
    expect(getRepeatDeadlineDay({}, '2026-04-01')).toBeUndefined();
  });

  it('should ignore invalid offsets', () => {
    expect(
      getRepeatDeadlineDay({ deadlineOffsetDays: -1 }, '2026-04-01'),
    ).toBeUndefined();
    expect(
      getRepeatDeadlineDay({ deadlineOffsetDays: 1.5 }, '2026-04-01'),
    ).toBeUndefined();
  });

  it('should keep the gap to the occurrence day', () => {
    expect(getRepeatDeadlineDay({ deadlineOffsetDays: 4 }, '2026-05-01')).toBe(
      '2026-05-05',
    );
    expect(getRepeatDeadlineDay({ deadlineOffsetDays: 0 }, '2026-05-01')).toBe(
      '2026-05-01',
    );
  });

  it('should cross month and DST boundaries', () => {
    expect(getRepeatDeadlineDay({ deadlineOffsetDays: 3 }, '2026-03-30')).toBe(
      '2026-04-02',
    );
    expect(getRepeatDeadlineDay({ deadlineOffsetDays: 2 }, '2026-10-24')).toBe(
      '2026-10-26',
    );
  });
});

describe('getDeadlineOffsetDays', () => {
  it('should return the gap in days', () => {
    expect(getDeadlineOffsetDays('2026-04-01', '2026-04-05')).toBe(4);
    expect(getDeadlineOffsetDays('2026-03-28', '2026-04-02')).toBe(5);
    expect(getDeadlineOffsetDays('2026-04-01', '2026-04-01')).toBe(0);
  });

  it('should return undefined without a deadline or for one before the start', () => {
    expect(getDeadlineOffsetDays('2026-04-01', undefined)).toBeUndefined();
    expect(getDeadlineOffsetDays('2026-04-05', '2026-04-01')).toBeUndefined();
  });
});
