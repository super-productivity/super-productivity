/**
 * Escape a string for safe interpolation into HTML text or a double-quoted
 * attribute.
 *
 * Use whenever user-controlled text is fed into an `[innerHTML]` binding via
 * translation params. Task titles etc. originate from synced remote data, so an
 * unescaped title (e.g. `<img src=x onerror=...>`) rendered into a banner would
 * be a cross-device stored-XSS vector. `&` must be replaced first.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
