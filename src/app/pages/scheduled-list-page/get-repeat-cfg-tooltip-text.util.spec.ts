import { getRepeatCfgTooltipText } from './get-repeat-cfg-tooltip-text.util';
import { DateTimeLocales } from '../../core/locale.constants';

describe('getRepeatCfgTooltipText', () => {
  // A stable local-noon timestamp for the 'Next' value so its rendered date
  // does not cross a day boundary under any test timezone.
  const nextTs = new Date(2025, 7, 15, 12, 0, 0).getTime(); // 2025-08-15, local

  describe("'Last' date timezone handling (#9127)", () => {
    it('renders the effective-last day string as its own calendar day, not the UTC-parsed previous day', () => {
      // Regression: the old `new Date('2025-08-01')` parses as UTC midnight and
      // formatMonthDay renders it in local time, so users west of UTC see
      // "7/31". The util parses the string as a local day, so it stays "8/1".
      // The repo's `test:tz:la` job runs this under America/Los_Angeles.
      const result = getRepeatCfgTooltipText(
        nextTs,
        '2025-08-01',
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );

      expect(result).toBe('Next 8/15, Last 8/1');
      expect(result).not.toContain('7/31');
    });

    it('does not drift across a month boundary', () => {
      const result = getRepeatCfgTooltipText(
        null,
        '2025-12-31',
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );

      expect(result).toContain('Last 12/31');
      expect(result).not.toContain('12/30');
    });

    it('does not drift across a year boundary', () => {
      const result = getRepeatCfgTooltipText(
        null,
        '2026-01-01',
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );

      expect(result).toContain('Last 1/1');
      expect(result).not.toContain('12/31');
    });
  });

  describe('locale ordering', () => {
    it('renders month-first for en-US', () => {
      const result = getRepeatCfgTooltipText(
        null,
        '2025-08-01',
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );
      expect(result).toContain('Last 8/1');
    });

    it('renders day-first for en-GB', () => {
      const result = getRepeatCfgTooltipText(
        null,
        '2025-08-01',
        DateTimeLocales.en_gb,
        'Next',
        'Last',
      );
      expect(result).toContain('Last 1/8');
    });

    it('renders day-first for de-DE', () => {
      const result = getRepeatCfgTooltipText(
        null,
        '2025-08-01',
        DateTimeLocales.de_de,
        'Next',
        'Last',
      );
      expect(result).toContain('Last 1.8');
    });
  });

  describe('missing values', () => {
    it('yields an empty last segment (no "Invalid Date") when the last day is undefined', () => {
      const result = getRepeatCfgTooltipText(
        nextTs,
        undefined,
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );

      expect(result).toBe('Next 8/15, Last ');
      expect(result).not.toContain('Invalid');
    });

    it('yields an empty next segment when the next timestamp is null', () => {
      const result = getRepeatCfgTooltipText(
        null,
        '2025-08-01',
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );

      expect(result).toBe('Next , Last 8/1');
    });

    it('still renders both labels when both values are missing', () => {
      const result = getRepeatCfgTooltipText(
        null,
        undefined,
        DateTimeLocales.en_us,
        'Next',
        'Last',
      );

      expect(result).toBe('Next , Last ');
    });
  });
});
