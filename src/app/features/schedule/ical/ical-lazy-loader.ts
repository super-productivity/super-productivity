/**
 * Lazy loader for ical.js to reduce initial bundle size.
 * The ical.js library is ~76KB and only needed for calendar integration.
 */

// ical.js types don't correctly expose the runtime ICAL namespace API
// (parse, Component, Time, Timezone, TimezoneService, helpers, stringify, etc.)
type ICalModule = any;

let icalModule: ICalModule | null = null;

let loadingPromise: Promise<ICalModule> | null = null;

/**
 * Lazily loads the ical.js module on first use.
 * Subsequent calls return the cached module.
 * Concurrent calls share the same loading promise to prevent race conditions.
 */

export const loadIcalModule = async (): Promise<ICalModule> => {
  if (icalModule) {
    return icalModule;
  }
  if (!loadingPromise) {
    loadingPromise = import('ical.js').then((mod) => {
      // Handle both ESM default export and CommonJS module.exports
      icalModule = ((mod as Record<string, unknown>).default || mod) as ICalModule;
      return icalModule!;
    });
  }
  return loadingPromise;
};
