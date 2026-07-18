import { formatDate, registerLocaleData } from '@angular/common';
import { NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS } from './locale.constants';

/**
 * Covers the registration half of the navigator-fallback fix: without their
 * own locale data, en-AU/en-CA/… resolve through `en` (registered as en-GB in
 * prod) and render 24h time. These specs register the data exactly as main.ts
 * does — `registerLocaleData(m.default)` with no explicit id, relying on the
 * data's self-reported BCP-47 id — and assert the user-visible symptom:
 * 12h vs 24h `shortTime`.
 */
describe('NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS', () => {
  // 1pm is the discriminating hour: 12h renders "1:00 …", 24h renders "13:00".
  const onePm = new Date(2024, 0, 15, 13, 0);
  const loadedById = new Map<string, unknown>();

  // Which variants genuinely use 12h time; en-IE and en-ZA are 24h regions.
  const IS_TWELVE_HOUR: Record<string, boolean> = {
    en_au: true,
    en_ca: true,
    en_ie: false,
    en_in: true,
    en_nz: true,
    en_ph: true,
    en_sg: true,
    en_za: false,
  };

  beforeAll(async () => {
    await Promise.all(
      Object.entries(NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS).map(async ([key, load]) => {
        const m = await load();
        loadedById.set(key, m.default);
        registerLocaleData(m.default);
      }),
    );
  });

  it('has a 12h/24h expectation for every registered variant', () => {
    expect(Object.keys(IS_TWELVE_HOUR).sort()).toEqual(
      Object.keys(NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS).sort(),
    );
  });

  it('each data file self-reports the BCP-47 id its map key promises (keyless registration is safe)', () => {
    for (const [key, data] of loadedById) {
      const selfReportedId = (data as unknown[])[0] as string;
      expect(selfReportedId.toLowerCase()).toBe(key.replace(/_/g, '-'));
    }
  });

  Object.keys(NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS).forEach((key) => {
    const localeTag = key.replace(/_/g, '-');
    const twelveHour = IS_TWELVE_HOUR[key];

    it(`renders shortTime in ${twelveHour ? '12h' : '24h'} for ${localeTag}`, () => {
      const result = formatDate(onePm, 'shortTime', localeTag);
      if (twelveHour) {
        // e.g. "1:00 pm" (en-AU), "1:00 p.m." (en-CA), "1:00 PM" (en-PH) —
        // exact spacing/case varies per region, 12h is the invariant.
        expect(result).toMatch(/^1:00/);
      } else {
        expect(result).toMatch(/^13:00/);
      }
    });
  });
});
