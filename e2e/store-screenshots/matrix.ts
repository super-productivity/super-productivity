/**
 * Capture matrix for the automated screenshot pipeline.
 *
 * Stores have materially different requirements (see docs/plans). We capture at
 * each store's native pixel dimensions directly via Playwright projects, so the
 * post-processor only handles directory layout — no resizing.
 *
 * See `.claude/plans/ideally-i-d-like-to-vivid-giraffe.md` for the source spec
 * tables (MS Store / Mac App Store / Snap / Flathub / App Store / Play / F-Droid).
 */

export type Theme = 'light' | 'dark';
export type Locale = 'en' | 'de';

// 'de' temporarily disabled — re-add once translations are caught up.
export const LOCALES: readonly Locale[] = ['en'] as const;
export const THEMES: readonly Theme[] = ['light', 'dark'] as const;

/**
 * `width` / `height` are the OUTPUT (physical pixel) dimensions required by
 * the store. The Playwright config divides them by `deviceScaleFactor` to set
 * the CSS viewport, so the resulting screenshot lands at exactly width × height.
 */
export type ViewportSpec = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
};

/**
 * Each entry corresponds to a Playwright `project` in the screenshot config.
 * The key is also the on-disk directory name under `_master/<viewport>/`.
 */
export const VIEWPORTS = {
  /** Shared desktop master (16:10). 1280×800 CSS @2x → 2560×1600. The smaller
   *  of MAS's two listed Retina sizes — gives more apparent UI zoom than the
   *  1440×900 baseline while still being a native MAS submission size. MS
   *  Store min is 1366×768 so this still exceeds spec. */
  desktopMaster: { width: 2560, height: 1600, deviceScaleFactor: 2 },
  /** Apple App Store iPhone 6.9" portrait. CSS 430×932 @3x → 1290×2796. */
  iphone69: { width: 1290, height: 2796, deviceScaleFactor: 3, isMobile: true },
  /** Apple App Store iPad 13" portrait. CSS 1032×1376 @2x → 2064×2752. */
  ipad13: { width: 2064, height: 2752, deviceScaleFactor: 2, isMobile: true },
  /** Google Play phone portrait. CSS 412×915 @3x → 1236×2745.
   *  Matches modern flagships (Pixel 7/8, Galaxy S22+, OnePlus 11). 412 CSS
   *  stays below the 768px breakpoint so SP still renders its phone layout. */
  androidPhone: { width: 1236, height: 2745, deviceScaleFactor: 3, isMobile: true },
  /** Google Play 7" tablet landscape. CSS 960×600 @2x → 1920×1200.
   *  Portrait (600 CSS) was below the 768 desktop breakpoint and rendered
   *  the phone layout, which felt cramped — landscape stays in tablet
   *  layout and reads cleanly. */
  android7Tablet: { width: 1920, height: 1200, deviceScaleFactor: 2, isMobile: true },
  /** Google Play 10" tablet portrait. CSS 800×1280 @2x → 1600×2560.
   *  Standard 10" tablet portrait dimensions. */
  android10Tablet: { width: 1600, height: 2560, deviceScaleFactor: 2, isMobile: true },
} as const satisfies Record<string, ViewportSpec>;

export type ViewportName = keyof typeof VIEWPORTS;

export const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[];

/**
 * Mobile viewports — drives the side-nav-collapsed flag in the fixture.
 * Includes tablets too: at any of these widths we want a tighter sidenav
 * (icons-only) so content gets the room. Spec routing is a separate axis
 * (see PHONE_VIEWPORTS / TABLET_VIEWPORTS below).
 */
export const MOBILE_VIEWPORTS = [
  'iphone69',
  'ipad13',
  'androidPhone',
  'android7Tablet',
  'android10Tablet',
] as const satisfies readonly ViewportName[];

/**
 * "Phone-class": viewports < 768 CSS px wide where SP renders its mobile
 * layout (bottom-nav, no side panels). These run `scenarios/mobile/`.
 */
export const PHONE_VIEWPORTS = [
  'iphone69',
  'androidPhone',
] as const satisfies readonly ViewportName[];

/**
 * "Tablet-class": viewports ≥ 768 CSS px wide where SP renders the desktop
 * layout (sidenav, panels) but the canvas is taller-than-wide (iPad / 10"
 * portrait) or narrower than the desktopMaster (7" landscape). Routing these
 * to the desktop spec would push side panels off-screen; routing them to the
 * mobile spec wastes the canvas. They run `scenarios/tablet/` instead.
 */
export const TABLET_VIEWPORTS = [
  'ipad13',
  'android7Tablet',
  'android10Tablet',
] as const satisfies readonly ViewportName[];

import * as path from 'path';
const repoRoot = path.resolve(__dirname, '..', '..');
export const SCREENSHOTS_OUT_DIR = path.join(repoRoot, 'dist', 'screenshots');
/** Roots that hold raw scenario captures, separated by capture pipeline. */
export const MASTER_DIR_WEB = path.join(SCREENSHOTS_OUT_DIR, '_master');
export const MASTER_DIR_ELECTRON = path.join(SCREENSHOTS_OUT_DIR, '_master_electron');

/**
 * Per-store derivation rules used by `build-store-assets.ts`. Each rule maps
 * a source viewport to an output directory under `dist/screenshots/`.
 *
 * `localeLayout` controls how locales are split:
 *   'per-locale-dir' → `<store>/<locale>/NN-name.png`
 *   'fastlane'       → `fastlane/metadata/android/<locale>/images/<bucket>Screenshots/N.png`
 *   'global'         → `<store>/NN-name.png` (locale ignored, e.g. Snap)
 */
export type StoreRule = {
  store: string;
  source: ViewportName;
  localeLayout: 'per-locale-dir' | 'fastlane' | 'global';
  fastlaneBucket?: 'phone' | 'sevenInch' | 'tenInch';
  /** Hard cap on items per store (informational; we won't exceed via scenarios). */
  maxCount?: number;
  /**
   * Which capture pipeline produces the source. 'web' (default) reads from
   * `MASTER_DIR_WEB`; 'electron' reads from `MASTER_DIR_ELECTRON`.
   * Mac App Store and Flathub use 'electron' because they need native window
   * chrome (traffic-lights / GTK titlebar) only Electron can produce.
   */
  masterDir?: 'web' | 'electron';
  /**
   * Hard byte cap per file enforced by the store. When set, the post-processor
   * re-encodes outputs above the cap as JPEG (quality stepped down from 90 to
   * 60 until the file fits) and writes a `.jpg`. Currently only Snap caps
   * each entry at 2 MB; everything else keeps the lossless PNG.
   */
  maxBytes?: number;
};

export const STORE_RULES: readonly StoreRule[] = [
  {
    store: 'macappstore',
    source: 'desktopMaster',
    localeLayout: 'per-locale-dir',
    maxCount: 10,
    // Sources from the Electron pipeline so traffic-lights + titlebar are
    // captured. Run on a Mac via `npm run screenshots:capture:electron`.
    masterDir: 'electron',
  },
  // Web and Microsoft Store use the same desktop Chromium captures. Keep one
  // derived folder and pick at most 10 from it when submitting to MS Store.
  { store: 'desktop', source: 'desktopMaster', localeLayout: 'per-locale-dir' },
  // Snap technically caps at 5 entries, ≤2 MB each — pick which to upload
  // manually before submission. The 2 MB cap forces JPEG re-encode in the
  // post-processor; everything else stays lossless PNG.
  {
    store: 'snap',
    source: 'desktopMaster',
    localeLayout: 'global',
    maxBytes: 2 * 1024 * 1024,
  },
  // Flathub: metainfo.xml `<screenshot>` is single-gallery and sourced from the
  // Electron pipeline so the captures include native GTK chrome (Linux X11
  // host required — see README "Electron pipeline" section).
  {
    store: 'flathub',
    source: 'desktopMaster',
    localeLayout: 'global',
    masterDir: 'electron',
  },
  {
    store: 'ios/iphone-69',
    source: 'iphone69',
    localeLayout: 'per-locale-dir',
    maxCount: 10,
  },
  {
    store: 'ios/ipad-13',
    source: 'ipad13',
    localeLayout: 'per-locale-dir',
    maxCount: 10,
  },
  {
    store: 'play/phone',
    source: 'androidPhone',
    localeLayout: 'per-locale-dir',
    maxCount: 8,
  },
  { store: 'play/sevenInch', source: 'android7Tablet', localeLayout: 'per-locale-dir' },
  { store: 'play/tenInch', source: 'android10Tablet', localeLayout: 'per-locale-dir' },
  {
    store: 'fdroid',
    source: 'androidPhone',
    localeLayout: 'fastlane',
    fastlaneBucket: 'phone',
  },
  {
    store: 'fdroid',
    source: 'android7Tablet',
    localeLayout: 'fastlane',
    fastlaneBucket: 'sevenInch',
  },
  {
    store: 'fdroid',
    source: 'android10Tablet',
    localeLayout: 'fastlane',
    fastlaneBucket: 'tenInch',
  },
] as const;

/**
 * Pinned date used by the seed builder to materialize "today"-relative offsets.
 * Set via env so reruns produce identical output. Defaults to a fixed Wednesday
 * so weekday-dependent layouts (planner) render consistently.
 */
export const SCREENSHOT_BASE_DATE = new Date(
  process.env.SCREENSHOT_BASE_DATE ?? '2026-05-06T09:30:00',
);
