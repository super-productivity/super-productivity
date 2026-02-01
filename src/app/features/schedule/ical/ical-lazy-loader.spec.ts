// Eager import ensures ical.js is in the webpack test bundle,
// so the dynamic import() inside loadIcalModule() can resolve it.
import 'ical.js';
import { loadIcalModule } from './ical-lazy-loader';

describe('ical-lazy-loader', () => {
  describe('loadIcalModule', () => {
    it('should load the ical.js module', async () => {
      const ICAL = await loadIcalModule();

      expect(ICAL).toBeDefined();
      expect(ICAL.parse).toBeDefined();
      expect(ICAL.Component).toBeDefined();
    });

    it('should return the same module instance on subsequent calls', async () => {
      const first = await loadIcalModule();
      const second = await loadIcalModule();

      expect(first).toBe(second);
    });

    it('should handle concurrent calls without race conditions', async () => {
      const results = await Promise.all([
        loadIcalModule(),
        loadIcalModule(),
        loadIcalModule(),
        loadIcalModule(),
        loadIcalModule(),
      ]);

      const firstResult = results[0];
      results.forEach((result) => {
        expect(result).toBe(firstResult);
      });
    });
  });
});
