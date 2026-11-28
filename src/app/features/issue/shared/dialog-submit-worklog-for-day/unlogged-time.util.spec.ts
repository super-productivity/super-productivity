import { getUnloggedTimeMs, hasUnloggedTimeOnOtherDays } from './unlogged-time.util';

const DAY = '2026-08-05';
const EARLIER_DAY = '2026-08-04';
const LATER_DAY = '2026-08-06';

describe('getUnloggedTimeMs', () => {
  it('sums the unlogged time across every day', () => {
    expect(
      getUnloggedTimeMs({ [EARLIER_DAY]: 30000, [DAY]: 60000 }, { [EARLIER_DAY]: 10000 }),
    ).toBe(80000);
  });

  it('counts everything when nothing was logged', () => {
    expect(getUnloggedTimeMs({ [DAY]: 60000 }, undefined)).toBe(60000);
  });

  it('ignores days that were logged more than tracked', () => {
    expect(
      getUnloggedTimeMs({ [EARLIER_DAY]: 1000, [DAY]: 60000 }, { [EARLIER_DAY]: 5000 }),
    ).toBe(60000);
  });
});

describe('hasUnloggedTimeOnOtherDays', () => {
  it('is false for time on the finished day only', () => {
    expect(hasUnloggedTimeOnOtherDays({ [DAY]: 60000 }, undefined, DAY)).toBe(false);
  });

  it('is true for unlogged time on an earlier day', () => {
    expect(
      hasUnloggedTimeOnOtherDays({ [EARLIER_DAY]: 30000, [DAY]: 60000 }, undefined, DAY),
    ).toBe(true);
  });

  // the daily summary can finish a past day, so later days can exist
  it('is true for unlogged time on a later day', () => {
    expect(
      hasUnloggedTimeOnOtherDays({ [DAY]: 60000, [LATER_DAY]: 30000 }, undefined, DAY),
    ).toBe(true);
  });

  it('is false when the other day was already logged', () => {
    expect(
      hasUnloggedTimeOnOtherDays(
        { [EARLIER_DAY]: 30000, [DAY]: 60000 },
        { [EARLIER_DAY]: 30000 },
        DAY,
      ),
    ).toBe(false);
  });
});
