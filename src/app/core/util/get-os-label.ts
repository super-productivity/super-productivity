/**
 * OS family from a user-agent string, or null when unrecognised. Coarse on
 * purpose: the server already sees this UA on every HTTP request, so naming
 * the OS family leaks nothing new, unlike a hostname or model name would.
 * Order matters — Android UAs also contain "Linux".
 *
 * Lives next to the platform code (`generate-client-id.ts`) so OS detection
 * is not re-derived per feature — the drift that broke #9353.
 */
const OS_BY_UA: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Mac/, 'macOS'],
  [/Linux/, 'Linux'],
];

export const getOsLabel = (userAgent: string = navigator.userAgent): string | null =>
  OS_BY_UA.find(([re]) => re.test(userAgent))?.[1] ?? null;
