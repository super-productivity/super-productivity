import { CronExpressionParser } from 'cron-parser';
import { Log } from '../../../core/log';

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const isCronValid = (expr: string): boolean => {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// crono-eng WASM bridge — English → Quartz cron.
//
// Primary translator. `../../../../crono-eng` is built to a freestanding WASM
// module (`src/assets/crono-eng.wasm`) exposing a tiny ABI: write the UTF-8
// phrase into the buffer at `inputPtr()`, call `parse(len)`, then read the
// resulting cron string of the returned length from `outputPtr()`. The module
// loads lazily (and asynchronously) on first use; until it is ready — or if it
// fails to load — callers transparently fall back to the builtin regex parser
// below. Output is 6-field Quartz (`sec min hour dom mon dow`), which both
// `cron-parser` and `cronstrue` accept.
// ---------------------------------------------------------------------------

interface CronoEngExports {
  memory: WebAssembly.Memory;
  inputPtr: () => number;
  inputCap: () => number;
  outputPtr: () => number;
  parse: (len: number) => number;
}

const WASM_URL = 'assets/crono-eng.wasm';

let _wasm: CronoEngExports | null = null;
let _loadPromise: Promise<void> | null = null;

/**
 * Kicks off the (async) WASM load. Idempotent. Resolves once the module is
 * ready or once loading has been determined impossible/failed (it never
 * rejects — failure simply leaves the builtin parser as the active path).
 */
export const initEnglishToCron = (): Promise<void> => {
  if (_wasm) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  if (typeof WebAssembly === 'undefined' || typeof fetch === 'undefined') {
    return Promise.resolve();
  }
  _loadPromise = fetch(WASM_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} loading ${WASM_URL}`);
      return r.arrayBuffer();
    })
    .then((bytes) => WebAssembly.instantiate(bytes, {}))
    .then(({ instance }) => {
      _wasm = instance.exports as unknown as CronoEngExports;
    })
    .catch((e) => {
      Log.warn('crono-eng WASM load failed; using builtin cron parser', e);
    });
  return _loadPromise;
};

const cronoEngTranslate = (text: string): string | null => {
  if (!_wasm) {
    // Not loaded yet — start loading so later calls can use it, and let this
    // call fall through to the builtin parser.
    void initEnglishToCron();
    return null;
  }
  try {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > _wasm.inputCap()) return null;
    // Write input. (View created fresh; never held across the parse() call,
    // which may grow — and thus detach — the wasm memory buffer.)
    new Uint8Array(_wasm.memory.buffer, _wasm.inputPtr(), bytes.length).set(bytes);
    const n = _wasm.parse(bytes.length);
    if (n < 0) return null;
    const out = new Uint8Array(_wasm.memory.buffer, _wasm.outputPtr(), n);
    return new TextDecoder().decode(out);
  } catch (e) {
    Log.warn('crono-eng translate failed', e);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Builtin fallback parser (regex-based). Used only when the WASM module is not
// yet loaded or cannot translate a phrase.
// ---------------------------------------------------------------------------

const parseTimeOfDay = (text: string): { hour: number; minute: number } | null => {
  const m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
};

const parseWeekdays = (text: string): string | null => {
  // "weekdays" / "every weekday"
  if (/\bweekdays?\b/i.test(text) && !/\bweekends?\b/i.test(text)) return '1-5';
  if (/\bweekends?\b/i.test(text)) return '0,6';

  const found: number[] = [];
  // Range form: "monday through friday", "monday to friday", "mon-fri"
  const rangeMatch = text
    .toLowerCase()
    .match(
      /\b(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\s+(?:through|thru|to|-)\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/,
    );
  if (rangeMatch) {
    const a = WEEKDAY_NAMES[rangeMatch[1]];
    const b = WEEKDAY_NAMES[rangeMatch[2]];
    return `${a}-${b}`;
  }

  for (const [name, num] of Object.entries(WEEKDAY_NAMES)) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(text) && !found.includes(num)) found.push(num);
  }
  if (found.length === 0) return null;
  return found.sort((a, b) => a - b).join(',');
};

const parseMonths = (text: string): string | null => {
  const lc = text.toLowerCase();
  // Range: "march through november" / "march to november" / "march - november"
  const rangeMatch = lc.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(?:through|thru|to|-)\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/,
  );
  if (rangeMatch) {
    const a = MONTH_NAMES[rangeMatch[1]];
    const b = MONTH_NAMES[rangeMatch[2]];
    return `${a}-${b}`;
  }

  const found: number[] = [];
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(text) && !found.includes(num)) found.push(num);
  }
  if (found.length === 0) return null;
  return found.sort((a, b) => a - b).join(',');
};

const parseDayOfMonth = (text: string): string | null => {
  // "on the 1st", "on the 15th", "on day 5"
  const m = text.match(/\bon\s+(?:the\s+)?(?:day\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  if (d < 1 || d > 31) return null;
  return String(d);
};

/**
 * Best-effort English-to-cron (builtin fallback). Returns a 5-field cron
 * expression or null. Mirrors the subset of phrasings the WASM translator
 * handles so behaviour degrades gracefully before/without WASM:
 *   - "every day", "daily"                            → `0 0 * * *`
 *   - "every hour", "hourly"                           → `0 * * * *`
 *   - "weekdays"                                       → `0 0 * * 1-5`
 *   - "every monday" / "every saturday"                → `0 0 * * 6`
 *   - "monday through friday"                          → `0 0 * * 1-5`
 *   - "from march through november"                    → adds month part `3-11`
 *   - "at 9am" / "at 14:30" / "at 9:00 pm"             → sets hour/min
 *   - "on the 1st" / "on day 15"                       → day-of-month
 * Unparsed input returns null.
 */
const builtinEnglishToCron = (text: string): string | null => {
  const lc = text.toLowerCase();

  let minute = '0';
  let hour = '0';
  let dom = '*';
  let month = '*';
  let dow = '*';

  if (/\bhourly\b|\bevery\s+hour\b/.test(lc)) {
    minute = '0';
    hour = '*';
  } else if (/\bdaily\b|\bevery\s+day\b/.test(lc)) {
    // defaults already 0 0 * * *
  }

  const tod = parseTimeOfDay(lc);
  if (tod) {
    hour = String(tod.hour);
    minute = String(tod.minute);
  }

  const months = parseMonths(lc);
  if (months) month = months;

  const weekdays = parseWeekdays(lc);
  if (weekdays) dow = weekdays;

  const day = parseDayOfMonth(lc);
  if (day) dom = day;

  // If nothing concrete matched (no time, no month, no weekday, no day, no
  // daily/hourly), bail — we don't want to invent `0 0 * * *` for arbitrary
  // text the user typed.
  if (
    !tod &&
    !months &&
    !weekdays &&
    !day &&
    !/\bhourly\b|\bdaily\b|\bevery\s+(?:hour|day)\b/.test(lc)
  ) {
    return null;
  }

  const expr = `${minute} ${hour} ${dom} ${month} ${dow}`;
  return isCronValid(expr) ? expr : null;
};

/**
 * Translate English / natural-language schedule phrases into a cron expression
 * the recurrence engine can consume. Returns null for input that is neither a
 * valid cron expression nor a recognizable phrase, so callers can treat that
 * as "not a schedule".
 *
 * Resolution order:
 *   1. Already a valid cron expression → returned verbatim (covers raw cron and
 *      the canonical Quartz output crono-eng itself emits).
 *   2. crono-eng WASM translator (primary).
 *   3. Builtin regex parser (fallback, used until WASM is ready / on failure).
 *
 * The result is gated on `isCronValid` (cron-parser): crono-eng can translate
 * phrases into Quartz forms the recurrence engine cannot execute — e.g. a
 * specific year (`… 2026`), `W` (nearest weekday), `L-n` (n-to-last day), or
 * `#`-lists (biweekly). Returning such a cron would pass UI validation yet
 * silently never fire, so we reject it here (callers treat it as unsupported).
 */
export const naturalLanguageToCron = (input: string): string | null => {
  const text = input.trim();
  if (!text) return null;
  if (isCronValid(text)) return text;
  const candidate = cronoEngTranslate(text) ?? builtinEnglishToCron(text);
  return candidate && isCronValid(candidate) ? candidate : null;
};
