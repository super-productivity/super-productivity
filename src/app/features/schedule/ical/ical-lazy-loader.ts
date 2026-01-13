/**
 * Lazy loader for ical.js to reduce initial bundle size.
 * The ical.js library is ~76KB and only needed for calendar integration.
 */

let icalModule: any = null;

let loadingPromise: Promise<any> | null = null;

/**
 * Lazily loads the ical.js module on first use.
 * Subsequent calls return the cached module.
 * Concurrent calls share the same loading promise to prevent race conditions.
 */

export const loadIcalModule = async (): Promise<any> => {
  if (icalModule) {
    return icalModule;
  }
  if (!loadingPromise) {
    loadingPromise = import('ical.js').then((mod) => {
      // @ts-ignore - ical.js exports default
      // Handle both ESM default export and CommonJS module.exports
      icalModule = mod.default || mod;
      return icalModule;
    });
  }
  return loadingPromise;
};
