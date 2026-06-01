import { naturalLanguageToCron } from './parse-natural-cron.util';
import { isCronExpressionValid } from '../store/cron-occurrence.util';

// In the Karma/ChromeHeadless test environment the WASM asset is not served, so
// naturalLanguageToCron exercises the builtin regex fallback. These assertions
// are therefore engine-agnostic: they check that a phrase resolves to *some*
// engine-runnable cron (not a specific dialect), which holds for both the WASM
// translator and the fallback. Exhaustive phrase→cron correctness for the WASM
// path is covered by `npm run test:crono` (the corpus harness).

describe('naturalLanguageToCron()', () => {
  // Prevent the lazy WASM loader from issuing a real (hanging) network request
  // for the asset, which would leak an async macrotask across specs.
  beforeEach(() => {
    spyOn(window, 'fetch').and.rejectWith(new Error('no network in test'));
  });

  describe('raw cron passthrough', () => {
    ['0 0 9 * * 1', '0 0 * * *', '*/5 * * * *', '0 0 0 ? * MON', '0 0 0 L * ?'].forEach(
      (expr) => {
        it(`returns "${expr}" verbatim`, () => {
          expect(naturalLanguageToCron(expr)).toBe(expr);
        });
      },
    );
  });

  describe('recognized phrases resolve to an engine-runnable cron', () => {
    [
      'every day',
      'daily',
      'every hour',
      'weekdays',
      'every monday',
      'monday through friday',
      'at 9am',
      'on the 15th',
    ].forEach((phrase) => {
      it(`"${phrase}" → valid cron`, () => {
        const cron = naturalLanguageToCron(phrase);
        expect(cron).withContext('non-null').not.toBeNull();
        expect(isCronExpressionValid(cron as string))
          .withContext(`cron-parser runs "${cron}"`)
          .toBe(true);
      });
    });
  });

  describe('unrecognized / empty input → null', () => {
    ['', '   ', 'buy milk', 'xyzzy nonsense', 'lorem ipsum dolor'].forEach((input) => {
      it(`"${input}" → null`, () => {
        expect(naturalLanguageToCron(input)).toBeNull();
      });
    });
  });

  // Note: rejection of engine-unsupported Quartz forms (year/W/L-n/#-lists) is a
  // WASM-path behavior verified end-to-end by `npm run test:crono`; the builtin
  // fallback used here cannot produce those forms. The async WASM loader's
  // resilience is covered by the app/E2E rather than a unit assertion, since its
  // module-level load promise is shared across specs.
});
