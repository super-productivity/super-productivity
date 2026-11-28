import { isRepeatPreviewSeparable } from './is-repeat-preview-separable.util';

describe('isRepeatPreviewSeparable', () => {
  const TODAY = '2026-07-15';

  it('is true for a future day of a calendar-based series', () => {
    expect(isRepeatPreviewSeparable({}, '2026-07-16', TODAY)).toBe(true);
  });

  it('is false for today and for past days, which the dialog cannot separate', () => {
    expect(isRepeatPreviewSeparable({}, '2026-07-15', TODAY)).toBe(false);
    expect(isRepeatPreviewSeparable({}, '2026-07-14', TODAY)).toBe(false);
  });

  it('is false for a series that repeats from its completion date', () => {
    expect(
      isRepeatPreviewSeparable({ repeatFromCompletionDate: true }, '2026-07-16', TODAY),
    ).toBe(false);
  });

  it('is false without a day', () => {
    expect(isRepeatPreviewSeparable({}, undefined, TODAY)).toBe(false);
  });
});
