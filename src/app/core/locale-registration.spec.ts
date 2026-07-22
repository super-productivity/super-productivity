import { formatDate, registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import localeEnAu from '@angular/common/locales/en-AU';
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

    it('registers en-US under en-us so an explicit US locale is month-first/12h from first paint, not the en-GB seed', () => {
      registerDefaultLocale();
      // Without the explicit en-US registration, 'en-us' would resolve through
      // the en-GB 'en' seed above and render '15/01/2024' / '13:00'.
      expect(formatDate(onePm, 'shortDate', 'en-us')).toBe('1/15/24');
      expect(formatDate(onePm, 'shortTime', 'en-us')).toMatch(/^1:00/);
      // …and the en-GB seed under bare 'en' stays intact.
      expect(formatDate(onePm, 'shortTime', 'en')).toBe('13:00');
    });
  });

  describe('registerNavigatorLocale', () => {
    // The real en-* variants leak into the process-global locale registry from
    // locale.constants.spec (Angular has no unregister API), so asserting on
    // them would pass on that leak alone — Jasmine randomises suite order, so
    // whether the sibling suite ran first flips the result. Instead each spec
    // registers a synthetic 12h locale (real en-AU data re-tagged under an id
    // no other suite touches): a 12h render can then only mean *this* call
    // registered it, and an unregistered synthetic falls through 'en' to the
    // en-GB (24h) baseline below.
    const syntheticMapKeys: string[] = [];
    const addSynthetic12hLocale = (tag: string): string => {
      // registerNavigatorLocale derives the map key from the (lower-cased,
      // '_'-joined) nav language and registers keyless (by the data's self-id),
      // so key and self-id are both derived from `tag`.
      const mapKey = tag.toLowerCase().replace(/-/g, '_');
      const data = [...(localeEnAu as unknown[])];
      data[0] = tag.toLowerCase();
      NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS[mapKey] = () =>
        Promise.resolve({ default: data });
      syntheticMapKeys.push(mapKey);
      return tag;
    };

    beforeAll(() => {
      // Match prod ordering: the default locale is registered before the app
      // initializer runs, so an unregistered synthetic en-* resolves to en-GB
      // (24h) — which is exactly what the 12h assertions below must flip.
      registerDefaultLocale();
    });

    afterEach(() => {
      syntheticMapKeys.forEach((key) => delete NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS[key]);
      syntheticMapKeys.length = 0;
    });

    it('registers the data for a matched navigator.language (renders 12h, not the en-GB 24h fallback)', async () => {
      const tag = addSynthetic12hLocale('en-XA');
      await registerNavigatorLocale(tag);
      expect(formatDate(onePm, 'shortTime', tag.toLowerCase())).toMatch(/^1:00/);
    });

    it('resolves without throwing for a locale outside the navigator-fallback map', async () => {
      await expectAsync(registerNavigatorLocale('th-TH')).toBeResolved();
    });

    it('defaults to the same browser locale the date pipe resolves (getBrowserCultureLang, not navigator.language)', async () => {
      // Reading navigator.language instead would register data for a locale the
      // pipe never asks for whenever the two disagree. The synthetic tag is not
      // navigator.language, so the sabotage (default → navigator.language)
      // leaves it unregistered and the 12h assertion fails.
      const tag = addSynthetic12hLocale('en-XB');
      spyOn(TranslateService, 'getBrowserCultureLang').and.returnValue(tag);
      await registerNavigatorLocale();
      expect(formatDate(onePm, 'shortTime', tag.toLowerCase())).toMatch(/^1:00/);
    });

    it('resolves without throwing when the browser reports no culture language', async () => {
      spyOn(TranslateService, 'getBrowserCultureLang').and.returnValue(undefined);
      await expectAsync(registerNavigatorLocale()).toBeResolved();
    });

    describe('when the chunk load stalls', () => {
      // Clock in before/afterEach, not a try/finally inside the spec: if the
      // timeout ever regresses to a bare `await load()`, the assertion below
      // never settles and a `finally` would never run — leaking jasmine.clock()
      // and the mutated import map into every sibling suite for the rest of the
      // run. afterEach still runs when the spec times out, containing the leak.
      beforeEach(() => jasmine.clock().install());
      afterEach(() => jasmine.clock().uninstall());

      it('gives up on a stalled chunk load instead of holding up bootstrap', async () => {
        // A synthetic 12h loader that never resolves. Giving up leaves the tag
        // unregistered → it renders the en-GB 24h fallback; awaiting the stall
        // would hang the spec. A real 24h locale (en-IE) cannot discriminate:
        // its data is byte-identical to en-GB, so "loaded" and "abandoned"
        // render the same 13:00.
        const tag = 'en-XC';
        const mapKey = 'en_xc';
        syntheticMapKeys.push(mapKey);
        NAVIGATOR_FALLBACK_LOCALE_IMPORT_FNS[mapKey] = () => new Promise<never>(() => {});
        const pending = registerNavigatorLocale(tag);
        jasmine.clock().tick(2000);
        await expectAsync(pending).toBeResolved();
        expect(formatDate(onePm, 'shortTime', tag.toLowerCase())).toMatch(/^13:00/);
      });
    });
  });
});
