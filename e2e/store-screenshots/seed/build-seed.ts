/**
 * Materialize the date-offset seed template into a concrete backup JSON
 * importable via BackupService.importCompleteBackup() (i.e. the same shape as
 * `e2e/fixtures/test-backup.json`).
 *
 * Offsets handled:
 *   tasks:  dueDayOffset (days)        → dueDay: YYYY-MM-DD
 *           dueWithTimeOffsetMs        → dueWithTime: epoch ms
 *           timeSpentOnDayOffsets      → timeSpentOnDay keyed by YYYY-MM-DD
 *           created === 0              → base epoch ms (minus small jitter)
 *   notes:  createdOffsetMs / modifiedOffsetMs → created / modified
 *   tags / projects / TODAY: created === 0 → base epoch ms
 *   top-level timestamp & lastUpdate → base epoch ms
 */

import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_PATH = path.resolve(__dirname, 'seed.template.json');

/**
 * Backgrounds applied across all work-context themes (projects + tags).
 * Defaults are public Unsplash URLs (no API key needed) but they fetch over
 * the network at capture time — the only third-party dependency in this
 * pipeline. Override or disable via env:
 *
 *   SP_SCREENSHOT_BG_DARK_URL  / SP_SCREENSHOT_BG_LIGHT_URL  to substitute
 *   SP_SCREENSHOT_BG_DISABLE=1                               to drop bg entirely
 *
 * For offline / privacy-sensitive builds, vendor the images and point the
 * env vars at `/assets/...` paths served by the dev bundle.
 */
const BG_DARK_URL =
  process.env.SP_SCREENSHOT_BG_DARK_URL ??
  'https://images.unsplash.com/photo-1456530308602-976f6a4bb440?w=2560&q=85&auto=format';
const BG_LIGHT_URL =
  process.env.SP_SCREENSHOT_BG_LIGHT_URL ??
  'https://images.unsplash.com/photo-1523964977-2014b69c49bc?w=2560&q=85&auto=format';
const BG_DISABLED = process.env.SP_SCREENSHOT_BG_DISABLE === '1';
/**
 * Drives the per-context "Darken/lighten background image for better contrast"
 * slider (work-context theme `backgroundOverlayOpacity`, default 20%). Bumped
 * to 80 for screenshots so the bg image dims enough that task content reads
 * cleanly. Override via `SP_SCREENSHOT_BG_OVERLAY_OPACITY` (0–99).
 */
const BG_OVERLAY_OPACITY = Math.max(
  0,
  Math.min(99, Number(process.env.SP_SCREENSHOT_BG_OVERLAY_OPACITY ?? '80')),
);

const toDateStr = (d: Date): string => {
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const addDays = (base: Date, days: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

type AnyRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is AnyRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export type SeedOptions = {
  /** Two-letter locale code; written into globalConfig.localization.lng. */
  locale?: string;
  /**
   * Custom theme id (e.g. 'catppuccin-mocha'). Written into LS via the
   * fixture's addInitScript before the page loads — no field is set on the
   * imported globalConfig.
   */
  customTheme?: string;
};

export const buildSeed = (baseDate: Date, opts: SeedOptions = {}): AnyRecord => {
  const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const seed = JSON.parse(raw) as AnyRecord;
  delete seed['_doc'];

  const baseMs = baseDate.getTime();
  seed.timestamp = baseMs;
  seed.lastUpdate = baseMs;

  const data = seed.data as AnyRecord;

  // Locale: write into globalConfig.localization.lng. The selector
  // `selectLocalizationConfig` reads `cfg.localization` (NOT `cfg.lang`), and
  // the `applyLanguageFromState$` effect calls `LanguageService.setLng(lng)`
  // on every distinct change — including post-import.
  // See src/app/features/config/store/global-config.{reducer,effects}.ts.
  if (opts.locale) {
    const gc = data.globalConfig as AnyRecord;
    gc.localization = { ...(gc.localization as AnyRecord), lng: opts.locale };
  }

  // Custom theme: the active selection lives in localStorage (LS.CUSTOM_THEME)
  // and is wired by `fixture.ts` via addInitScript. No write into the seed
  // is required; `opts.customTheme` flows through to the fixture's init
  // script, not into the imported globalConfig.

  // Planner: materialize @@PLANNER_OFFSET_+N keys into YYYY-MM-DD strings.
  const planner = data.planner as AnyRecord;
  if (isRecord(planner.days)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(planner.days)) {
      const m = /^@@PLANNER_OFFSET_([+-]?\d+)$/.exec(k);
      if (m) out[toDateStr(addDays(baseDate, Number(m[1])))] = v;
      else out[k] = v;
    }
    planner.days = out;
  }

  // Task entities: materialize offsets, fix `created: 0` placeholders.
  const taskEntities = (data.task as AnyRecord).entities as Record<string, AnyRecord>;
  let createdJitter = 0;
  for (const t of Object.values(taskEntities)) {
    if (typeof t.dueDayOffset === 'number') {
      t.dueDay = toDateStr(addDays(baseDate, t.dueDayOffset));
      delete t.dueDayOffset;
    }
    if (typeof t.dueWithTimeOffsetMs === 'number') {
      t.dueWithTime = baseMs + t.dueWithTimeOffsetMs;
      delete t.dueWithTimeOffsetMs;
    }
    if (t.timeSpentOnDayKeysAreOffsets && isRecord(t.timeSpentOnDayOffsets)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(t.timeSpentOnDayOffsets)) {
        out[toDateStr(addDays(baseDate, Number(k)))] = Number(v);
      }
      t.timeSpentOnDay = out;
      delete t.timeSpentOnDayOffsets;
      delete t.timeSpentOnDayKeysAreOffsets;
    }
    if (t.created === 0) {
      t.created = baseMs - createdJitter;
      createdJitter += 1000;
    }
  }

  // Tag / TODAY: set created from base.
  const tagEntities = (data.tag as AnyRecord).entities as Record<string, AnyRecord>;
  for (const tag of Object.values(tagEntities)) {
    if (tag.created === 0) tag.created = baseMs;
  }

  // Background images: only apply to TAG themes (TODAY etc.) — not projects.
  // Projects should render against their own primary color so contexts like
  // catppuccin (or any custom theme) read clearly without a wallpaper
  // fighting them. To re-enable a bg image for a specific project, set it
  // explicitly in the template.
  const applyBg = (theme: AnyRecord): void => {
    if (BG_DISABLED) return;
    theme.backgroundImageDark = BG_DARK_URL;
    theme.backgroundImageLight = BG_LIGHT_URL;
    theme.backgroundOverlayOpacity = BG_OVERLAY_OPACITY;
  };
  for (const t of Object.values(tagEntities)) {
    if (isRecord(t.theme)) applyBg(t.theme);
  }

  // Notes: createdOffsetMs / modifiedOffsetMs → absolute.
  const noteEntities = (data.note as AnyRecord).entities as Record<string, AnyRecord>;
  for (const n of Object.values(noteEntities)) {
    if (typeof n.createdOffsetMs === 'number') {
      n.created = baseMs + n.createdOffsetMs;
      delete n.createdOffsetMs;
    }
    if (typeof n.modifiedOffsetMs === 'number') {
      n.modified = baseMs + n.modifiedOffsetMs;
      delete n.modifiedOffsetMs;
    }
  }

  return seed;
};

/**
 * Write the materialized seed to disk so ImportPage can pick it up via
 * setInputFiles. Returns the absolute path.
 */
export const writeSeedFile = (
  baseDate: Date,
  outDir: string,
  opts: SeedOptions = {},
): string => {
  const seed = buildSeed(baseDate, opts);
  fs.mkdirSync(outDir, { recursive: true });
  const tag = [baseDate.toISOString().slice(0, 10), opts.locale, opts.customTheme]
    .filter(Boolean)
    .join('-');
  const out = path.resolve(outDir, `seed-${tag}.json`);
  fs.writeFileSync(out, JSON.stringify(seed, null, 2), 'utf-8');
  return out;
};
