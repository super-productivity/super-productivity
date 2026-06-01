import { naturalLanguageToCron } from './parse-natural-cron.util';

// Metamorphic tests: rather than asserting exact outputs, assert RELATIONS
// between outputs that must hold regardless of dialect. The WASM asset is not
// served under Karma, so the builtin fallback runs — but these relations hold
// for either engine. (Exact phrase→cron correctness lives in the corpus harness,
// `npm run test:crono`.)

describe('naturalLanguageToCron — metamorphic relations', () => {
  beforeEach(() => {
    spyOn(window, 'fetch').and.rejectWith(new Error('no network in test'));
  });

  const n = (s: string): string | null => naturalLanguageToCron(s);

  it('is deterministic (same input → same output)', () => {
    expect(n('every monday')).toBe(n('every monday'));
    expect(n('at 9am')).toBe(n('at 9am'));
  });

  it('is case-insensitive', () => {
    expect(n('EVERY MONDAY')).toBe(n('every monday'));
    expect(n('Every Weekday')).toBe(n('every weekday'));
    expect(n('AT 9AM')).toBe(n('at 9am'));
  });

  it('ignores surrounding / internal extra whitespace', () => {
    const base = n('every monday');
    expect(n('   every monday   ')).toBe(base);
    expect(n('every   monday')).toBe(base);
    expect(n('\tevery monday\n')).toBe(base);
  });

  it('is order-independent for time + weekday', () => {
    expect(n('every monday at 9am')).toBe(n('at 9am every monday'));
  });

  it('is invariant to irrelevant leading words', () => {
    // Extra non-schedule words must not change the recognized schedule.
    expect(n('do chores every monday')).toBe(n('every monday'));
    expect(n('please water plants every day')).toBe(n('every day'));
  });

  it('is idempotent: feeding a result back returns it unchanged', () => {
    for (const phrase of ['every day', 'every monday', 'weekdays', 'at 9am']) {
      const once = n(phrase);
      expect(once).withContext(phrase).not.toBeNull();
      expect(n(once as string))
        .withContext(`idempotent for ${phrase} → ${once}`)
        .toBe(once);
    }
  });

  it('passes raw cron through verbatim and stably', () => {
    for (const cron of ['0 9 * * 1', '0 0 * * *', '0 0 0 ? * MON', '0 0 0 L * ?']) {
      expect(n(cron)).toBe(cron);
      expect(n(n(cron) as string)).toBe(cron);
    }
  });

  it('returns null consistently for unrecognized input', () => {
    for (const junk of ['', '   ', 'asdf qwer', 'buy milk and eggs']) {
      expect(n(junk)).toBeNull();
    }
  });
});
