import { test, expect } from '../../fixtures/test.fixture';
import { type Page } from '@playwright/test';

// Verifies the REAL occurrence engine (exposed on __e2eTestHelpers.cron in
// dev/stage builds) under forced browser timezones. Playwright's timezoneId is
// reliable regardless of host OS, so this closes the gap the Karma suite cannot
// (Chrome on Windows ignores the TZ env var).
//
// Each zone asserts BOTH that the timezone was actually applied (via the live
// UTC offset) AND that the engine's day-class results are correct in it — so
// the coverage is real, not vacuously TZ-stable.

type ProbeResult = {
  tzOffsetJun: number;
  monWeekday: number;
  day15: number;
  dailyNextFromJun15: string | null;
  dstSpringNext: string | null;
  dstSpringNewest: string | null;
  firstMonOnSatStart: string | null;
};

// getTimezoneOffset() in June 2024 (minutes behind UTC; negative = ahead).
const EXPECTED_JUNE_OFFSET: Record<string, number> = {
  UTC: 0,
  'America/Los_Angeles': 420, // PDT, UTC-7
  'Asia/Tokyo': -540, // UTC+9
  'Australia/Sydney': -600, // AEST in June (southern winter), UTC+10
  'Pacific/Chatham': -765, // CHAST, UTC+12:45
};
const ZONES = Object.keys(EXPECTED_JUNE_OFFSET);

const probe = (page: Page): Promise<ProbeResult> =>
  page.evaluate(() => {
    type Cfg = {
      repeatCycle: string;
      cronExpression: string;
      startDate: string;
      lastTaskCreationDay: string;
      repeatEvery: number;
    };
    type CronApi = {
      getNextCronOccurrence: (c: Cfg, d: Date) => Date | null;
      getNewestPossibleCronDueDate: (c: Cfg, d: Date) => Date | null;
      getFirstCronOccurrence: (c: Cfg) => Date | null;
    };
    const h = (window as unknown as { __e2eTestHelpers?: { cron?: CronApi } })
      .__e2eTestHelpers;
    if (!h?.cron) throw new Error('cron helpers missing');
    const cron = h.cron;
    const cfg = (cronExpression: string, extra: Partial<Cfg> = {}): Cfg => ({
      repeatCycle: 'CRON',
      cronExpression,
      startDate: '1970-01-01',
      lastTaskCreationDay: '1970-01-01',
      repeatEvery: 1,
      ...extra,
    });
    const dstr = (d: Date | null): string | null =>
      d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate(),
          ).padStart(2, '0')}`
        : null;
    const jun15 = new Date(2024, 5, 15, 12);
    const nextMon = cron.getNextCronOccurrence(cfg('0 0 0 ? * MON'), jun15);
    const next15 = cron.getNextCronOccurrence(cfg('0 0 0 15 * ?'), jun15);
    return {
      tzOffsetJun: new Date(2024, 5, 15).getTimezoneOffset(),
      monWeekday: nextMon ? nextMon.getDay() : -1,
      day15: next15 ? next15.getDate() : -1,
      dailyNextFromJun15: dstr(cron.getNextCronOccurrence(cfg('0 0 0 * * ?'), jun15)),
      // US spring-forward day; the day-walk getNewest is DST-safe.
      dstSpringNext: dstr(
        cron.getNextCronOccurrence(cfg('0 0 0 * * ?'), new Date(2024, 2, 9, 12)),
      ),
      dstSpringNewest: dstr(
        cron.getNewestPossibleCronDueDate(cfg('0 0 0 * * ?'), new Date(2024, 2, 10, 12)),
      ),
      firstMonOnSatStart: dstr(
        cron.getFirstCronOccurrence(cfg('0 0 0 ? * MON', { startDate: '2024-06-01' })),
      ),
    };
  });

for (const tz of ZONES) {
  test.describe(`cron occurrence engine under ${tz}`, () => {
    test.use({ timezoneId: tz });

    test('timezone is applied and day-class results are correct', async ({
      page,
      workViewPage,
    }) => {
      await workViewPage.waitForTaskList();
      await page.waitForFunction(
        () =>
          !!(window as unknown as { __e2eTestHelpers?: { cron?: unknown } })
            .__e2eTestHelpers?.cron,
        undefined,
        { timeout: 10000 },
      );

      const r = await probe(page);
      // 1) Confirm the browser timezone was actually forced.
      expect(r.tzOffsetJun, `${tz} offset`).toBe(EXPECTED_JUNE_OFFSET[tz]);
      // 2) Day-class results are correct in that timezone.
      expect(r.monWeekday, 'weekly Monday → Monday').toBe(1);
      expect(r.day15, 'monthly day-15 → 15th').toBe(15);
      expect(r.dailyNextFromJun15, 'daily → next day').toBe('2024-06-16');
      expect(r.dstSpringNext, 'daily next across spring-forward').toBe('2024-03-10');
      expect(r.dstSpringNewest, 'daily newest on spring-forward day').toBe('2024-03-10');
      expect(r.firstMonOnSatStart, 'first Monday on/after Sat start').toBe('2024-06-03');
    });
  });
}
