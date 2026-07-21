import { formatDate, registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import { TranslateService } from '@ngx-translate/core';
import { registerDefaultLocale, registerNavigatorLocale } from './locale-registration';
import { NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS } from './locale.constants';

/**
 * Exercises the production registration path used by main.ts (module-scope
 * registerDefaultLocale + app-initializer registerNavigatorLocale), asserting
 * the user-visible formats rather than registry internals.
 */
describe('locale-registration', () => {
  // 1pm discriminates 12h ("1:00 …") from 24h ("13:00"); Jan 15 discriminates
  // day-first shortDate (en-GB "15/01/2024") from month-first (en-US "1/15/24").
  const onePm = new Date(2024, 0, 15, 13, 0);

  afterAll(() => {
    // The locale registry is module-global across the Karma run. Restore 'en'
    // to the baked-in en-US data, which is observably identical to the
    // pristine unregistered state (Angular's parent-locale shortcut).
    registerLocaleData(localeEn, 'en');
  });

  describe('registerDefaultLocale', () => {
    it('registers en-GB data under the bare en id (day-first shortDate, 24h shortTime)', () => {
      registerDefaultLocale();
      expect(formatDate(onePm, 'shortDate', 'en')).toBe('15/01/2024');
      expect(formatDate(onePm, 'shortTime', 'en')).toBe('13:00');
    });
  });

  describe('registerNavigatorLocale', () => {
    beforeAll(() => {
      // Match prod ordering: the default locale is registered before the app
      // initializer runs, so unregistered en-* resolves to en-GB (24h) — which
      // is exactly what the 12h assertion below must flip.
      registerDefaultLocale();
    });

    it('registers the data for a matched navigator.language (en-AU renders 12h, not the en-GB 24h fallback)', async () => {
      await registerNavigatorLocale('en-AU');
      expect(formatDate(onePm, 'shortTime', 'en-AU')).toMatch(/^1:00/);
    });

    it('resolves without throwing for a locale outside the navigator-fallback map', async () => {
      await expectAsync(registerNavigatorLocale('th-TH')).toBeResolved();
    });

    it('defaults to the same browser locale the date pipe resolves (getBrowserCultureLang, not navigator.language)', async () => {
      // Reading navigator.language instead would register data for a locale the
      // pipe never asks for whenever the two disagree.
      spyOn(TranslateService, 'getBrowserCultureLang').and.returnValue('en-NZ');
      await registerNavigatorLocale();
      expect(formatDate(onePm, 'shortTime', 'en-NZ')).toMatch(/^1:00/);
    });

    it('resolves without throwing when the browser reports no culture language', async () => {
      spyOn(TranslateService, 'getBrowserCultureLang').and.returnValue(undefined);
      await expectAsync(registerNavigatorLocale()).toBeResolved();
    });

    it('gives up on a stalled chunk load instead of holding up bootstrap', async () => {
      // en-IE is 12h; asserting the en-GB 24h fallback proves the stalled load
      // was abandoned rather than awaited (and that we did not hang here).
      const origLoad = NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS['en_ie'];
      NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS['en_ie'] = () => new Promise(() => {});
      jasmine.clock().install();
      try {
        const pending = registerNavigatorLocale('en-IE');
        jasmine.clock().tick(1500);
        await expectAsync(pending).toBeResolved();
        expect(formatDate(onePm, 'shortTime', 'en-IE')).toBe('13:00');
      } finally {
        jasmine.clock().uninstall();
        NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS['en_ie'] = origLoad;
      }
    });
  });
});
