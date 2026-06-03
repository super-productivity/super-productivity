/**
 * Video pipeline fixture. Mirrors the web-mode setup of the screenshot fixture
 * (`e2e/store-screenshots/fixture.ts`) but creates its own browser context
 * with `recordVideo` enabled, since `browser.newContext()` does not inherit
 * the project's `use.video` setting.
 *
 * Recording lands in a variant directory such as
 * `.tmp/video/recordings/default/<random>.webm` or
 * `.tmp/video/recordings/ms-store/<random>.webm` after the page closes;
 * `build-video.ts` picks the most recent one for the same variant.
 *
 * Trim handling: the recording necessarily includes ~16s of seed-import
 * navigation before the choreographed beats begin. The fixture timestamps the
 * moment of context creation; the spec calls `markBeatsStart()` once seeded
 * and ready. The delta (an offset in ms) is written to a sidecar JSON that
 * `build-video.ts` consumes, so ffmpeg can `-ss` past the lead-in. Single-
 * worker assumption — the sidecar is shared, which is fine because we run
 * `workers: 1`.
 */

import { test as base, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ImportPage } from '../pages/import.page';
import { writeSeedFile } from '../store-screenshots/seed/build-seed';
import {
  SCREENSHOT_BASE_DATE,
  type Locale,
  type Theme,
} from '../store-screenshots/matrix';
import { waitForAppReady } from '../utils/waits';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SEED_DIR = path.join(REPO_ROOT, '.tmp', 'video-seeds');
const VARIANT = process.env.REEL_VARIANT ?? '';
const RECORDINGS_DIR = path.join(REPO_ROOT, '.tmp', 'video', 'recordings');
const variantDirName = (VARIANT || 'default').replace(/[^a-z0-9_-]+/gi, '-');
const RECORDING_DIR = path.join(RECORDINGS_DIR, variantDirName);
const TRIM_SIDECAR_PATH = path.join(RECORDING_DIR, '_latest-trim.json');

type VideoProfile = {
  size: { width: number; height: number };
  deviceScaleFactor: number;
};

const getVideoProfile = (): VideoProfile => {
  if (process.env.REEL_VARIANT === 'ms-store') {
    return {
      // Microsoft Store trailers must be exactly 1920x1080. Keep the backing
      // surface at 1x here; 2x would render a 3840x2160 page before recording.
      size: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    };
  }

  if (process.env.REEL_VARIANT === 'shorts') {
    return {
      // 9:16 portrait at 1080x1920 — the canonical short-form video size for
      // TikTok / YouTube Shorts / Instagram Reels / Mastodon. DPR 1 keeps the
      // backing surface at 1080x1920 (DPR 2 would render 2160x3840 per frame
      // and the recorder starts dropping frames).
      size: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
    };
  }

  if (process.env.REEL_VARIANT === 'mobile') {
    return {
      // 19.5:9 phone aspect (iPhone Pro Max / Pixel Pro). Renders as a
      // recognizable "phone screen" frame for app-store mobile previews
      // and Play Store "feature graphic" promo clips.
      size: { width: 1080, height: 2340 },
      deviceScaleFactor: 1,
    };
  }

  return {
    // Square 1024x1024 plays well on social embeds and matches the rhythm of
    // the GitHub README. DPR 2 renders the page at 2x physical pixels, then
    // Playwright downsamples into 1024x1024 for sharper text on the gif.
    size: { width: 1024, height: 1024 },
    deviceScaleFactor: 2,
  };
};

// Viewport == recording size, otherwise Playwright pads the smaller axis with
// gray. The profile is selected by REEL_VARIANT so the choreography can be
// reused for square README assets and 16:9 Store trailers.
const VIDEO_PROFILE = getVideoProfile();
const VIDEO_SIZE = VIDEO_PROFILE.size;
const DEVICE_SCALE_FACTOR = VIDEO_PROFILE.deviceScaleFactor;

type VideoFixtures = {
  locale: Locale;
  theme: Theme;
  customTheme: string | undefined;
  seedFile: string;
  seededPage: Page;
  /**
   * Call once the app is in the desired starting state (post-seed-import,
   * post-settle) and the choreographed beats are about to begin. The fixture
   * writes a sidecar JSON with the offset so `build-video.ts` can trim the
   * recording's lead-in.
   */
  markBeatsStart: () => void;
};

const ONBOARDING_INIT = (): void => {
  localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
  localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
  localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
  localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
  // Collapsed icon-only sidenav for the reel — denser content, more "app
  // feels alive" framing without the wider expanded sidebar.
  localStorage.setItem('SUP_NAV_SIDEBAR_EXPANDED', 'false');
  // Right panel narrowed to RIGHT_PANEL_CONFIG.MIN_WIDTH (250px). This is
  // the smallest width the panel allows before its close-threshold kicks
  // in — pre-seeding via the panel's own persistence path means the
  // schedule grid inside computes its column widths against 250px and
  // doesn't overflow the panel's right edge. Earlier iterations forced
  // `width !important` on .side, which sized the chrome but didn't tell
  // the schedule grid, leaving event blocks spilling past the viewport.
  localStorage.setItem('SUP_RIGHT_PANEL_WIDTH', '250');
};

// Shared between the page fixture (writer) and markBeatsStart (reader).
// Single-worker invariant — see file header.
const recordingState: { startMs: number } = { startMs: 0 };

export const test = base.extend<VideoFixtures>({
  locale: ['en', { option: true }] as never,
  theme: ['dark', { option: true }] as never,
  customTheme: [undefined, { option: true }] as never,

  seedFile: async ({ locale, customTheme }, use) => {
    const file = writeSeedFile(SCREENSHOT_BASE_DATE, SEED_DIR, {
      locale,
      customTheme,
    });
    await use(file);
  },

  // Override the default page fixture so we can pass `recordVideo` to the
  // context. `use.video` from the project config only applies to Playwright's
  // built-in default context.
  page: async ({ browser, baseURL, theme, locale }, use, testInfo) => {
    // Captured as close to context creation as possible. A ~tens-of-ms delay
    // before recording really starts means we under-estimate by that amount,
    // i.e. trim slightly less — safer than over-trimming into beat 1's fade-in.
    recordingState.startMs = Date.now();
    const isMobile = VARIANT === 'mobile';
    const context = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:4242',
      userAgent: `PLAYWRIGHT-VIDEO-${testInfo.workerIndex}`,
      storageState: undefined,
      // Pin navigator.language so ImportPage's English text matchers work
      // regardless of host locale. UI locale is switched after seed import.
      locale: 'en-US',
      viewport: VIDEO_SIZE,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      // Mobile variant: enable real touch dispatch so `page.touchscreen.tap`
      // fires pointer/touch events the app's drag/click handlers recognize
      // as a finger, and so any responsive `isMobile` branches activate.
      hasTouch: isMobile,
      isMobile,
      recordVideo: {
        dir: RECORDING_DIR,
        size: VIDEO_SIZE,
      },
    });
    const page = await context.newPage();

    await page.clock.install({ time: SCREENSHOT_BASE_DATE });

    await page.addInitScript(ONBOARDING_INIT);
    await page.addInitScript((variant) => {
      // Stash variant on body so overlays.ts / scenarios can branch via
      // attribute selectors without re-reading process.env in the page.
      const apply = (): void => {
        document.body.dataset.spVideoVariant = variant || 'default';
      };
      if (document.body) apply();
      else document.addEventListener('DOMContentLoaded', apply, { once: true });
    }, VARIANT);
    await page.addInitScript((darkMode) => {
      try {
        localStorage.setItem('DARK_MODE', darkMode);
      } catch {
        /* noop */
      }
    }, theme);
    await page.addInitScript((initialLocale) => {
      (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale =
        initialLocale;
    }, locale);
    // Mobile variant: tap-ripple instead of cursor ring. The recorder
    // doesn't draw a touch indicator on its own, so taps would otherwise
    // read as instant state changes with no on-frame cause. Each
    // touchstart spawns a short-lived expanding ring at the touch point.
    if (isMobile) {
      await page.addInitScript(() => {
        const attach = (): void => {
          if (document.getElementById('__sp-video-tap-ripple-style')) return;
          const style = document.createElement('style');
          style.id = '__sp-video-tap-ripple-style';
          style.textContent = `
            .__sp-video-tap-ripple {
              position: fixed;
              top: 0;
              left: 0;
              width: 0;
              height: 0;
              border-radius: 50%;
              background: radial-gradient(rgba(255,255,255,0.85) 0%,rgba(255,255,255,0.4) 40%,rgba(255,255,255,0) 75%);
              z-index: 2147483640;
              pointer-events: none;
              opacity: 0.9;
              transform: translate3d(-9999px,-9999px,0);
              transition: width 520ms ease-out, height 520ms ease-out, opacity 620ms ease-out, transform 520ms ease-out;
            }
          `;
          document.head.appendChild(style);
          const spawn = (clientX: number, clientY: number): void => {
            const r = document.createElement('div');
            r.className = '__sp-video-tap-ripple';
            r.style.transform = `translate3d(${clientX}px,${clientY}px,0)`;
            document.body.appendChild(r);
            void r.offsetWidth;
            const finalSize = 220;
            const half = finalSize / 2;
            r.style.width = `${finalSize}px`;
            r.style.height = `${finalSize}px`;
            r.style.marginLeft = `${-half}px`;
            r.style.marginTop = `${-half}px`;
            r.style.opacity = '0';
            window.setTimeout(() => r.remove(), 700);
          };
          document.addEventListener(
            'touchstart',
            (e) => {
              for (const t of Array.from(e.touches)) spawn(t.clientX, t.clientY);
            },
            { passive: true, capture: true },
          );
          // Synthetic taps from Playwright sometimes route through pointer
          // events without touch events — listen to both for coverage.
          document.addEventListener(
            'pointerdown',
            (e) => {
              if (e.pointerType !== 'mouse') spawn(e.clientX, e.clientY);
            },
            { passive: true, capture: true },
          );
        };
        if (document.body) attach();
        else document.addEventListener('DOMContentLoaded', attach, { once: true });
      });
    }
    // Inject a soft ring that follows the cursor — at 1024×1024 the OS
    // pointer is small and easy to miss; this makes drag motions read on
    // the gif. The ring is at z-index 2147483640 (under the full-screen
    // cards which sit higher) so it's automatically hidden during beat 4/5.
    // Spec code can also toggle visibility per-beat by adding/removing the
    // `__sp-hide-cursor-highlight` class on body — used during the capture
    // beat where the cursor sits in the middle of the focused input and
    // would otherwise read as a stray white dot. Skipped for the mobile
    // variant: no cursor on touch, the tap ripple handles it.
    if (!isMobile) {
      await page.addInitScript(() => {
        const attach = (): void => {
          const id = '__sp-video-cursor-highlight';
          if (document.getElementById(id)) return;
          const dot = document.createElement('div');
          dot.id = id;
          dot.style.cssText = [
            'position:fixed',
            'top:0',
            'left:0',
            'width:36px',
            'height:36px',
            'margin:-18px 0 0 -18px',
            'border-radius:50%',
            'background:radial-gradient(rgba(255,255,255,0.55) 0%,rgba(255,255,255,0.18) 45%,rgba(255,255,255,0) 70%)',
            'z-index:2147483640',
            'pointer-events:none',
            'transform:translate3d(-9999px,-9999px,0)',
            'will-change:transform',
            'transition:opacity 150ms ease-out',
          ].join(';');
          document.body.appendChild(dot);
          const visibilityStyle = document.createElement('style');
          visibilityStyle.textContent =
            'body.__sp-hide-cursor-highlight #__sp-video-cursor-highlight{opacity:0!important}';
          document.head.appendChild(visibilityStyle);
          document.addEventListener(
            'mousemove',
            (e) => {
              dot.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
            },
            { passive: true },
          );
        };
        if (document.body) attach();
        else document.addEventListener('DOMContentLoaded', attach, { once: true });
      });
    }

    // Suppress UI noise that fights with the choreographed reel:
    //  - Material/CDK tooltips (cursor lingering would otherwise pop one)
    //  - Reminder dialogs (clock.runFor in beat 3 advances time and would
    //    otherwise trigger the seed's task reminders mid-recording)
    //  - app-root zoom (1.4) — visually "zooms in" on the SP UI without
    //    shrinking the recording canvas. The add-task-bar uses its real
    //    default styles (max-width 720, width 90%); at zoom 1.4 inside a
    //    1024 viewport that lands well inside the frame. Earlier 1.5 was
    //    cropping the right edge of the work view; 1.4 leaves enough
    //    inner-viewport (731px) for the layout to breathe. Overlays are
    //    siblings of app-root in the DOM tree, so they are unaffected by
    //    this zoom.
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.id = '__sp-video-injected-styles';
      style.textContent = `
        mat-tooltip-component,
        .mat-mdc-tooltip,
        .cdk-overlay-container .mat-mdc-tooltip,
        .cdk-overlay-container .mat-tooltip,
        .cdk-overlay-container [role="tooltip"] {
          visibility: hidden !important;
          opacity: 0 !important;
        }
        /* Hide Material dialogs that would modal over the actual reel, but
           keep the import encryption warning actionable during the trimmed
           pre-roll seed import. focus-mode-overlay is its own element, not a
           mat-dialog, so it's unaffected. */
        .cdk-overlay-pane:has(.mat-mdc-dialog-container):not(:has(dialog-import-encryption-warning)),
        .cdk-overlay-pane:has(mat-dialog-container):not(:has(dialog-import-encryption-warning)) {
          display: none !important;
        }
        /* Hide every Material snack bar — beat 1's task-add and beat 4's
           focus-mode-exit both fire snacks ("Task added", "Deleted
           Reminder") that would otherwise sit at the bottom of the frame
           into the next beat. Clock is installed throughout most of the
           reel, so the snacks' auto-dismiss timers don't fire on their
           own. Hide them outright. */
        .mat-mdc-snack-bar-container,
        snack-custom,
        .cdk-overlay-pane:has(snack-custom),
        .cdk-overlay-pane:has(.mat-mdc-snack-bar-container) {
          display: none !important;
        }
        app-root {
          zoom: 1.4;
        }
        /* Shorts (9:16, 1080x1920): zoom up further so the work-view fills
           the portrait canvas. The inner viewport is 1080/1.6 = 675 wide,
           1920/1.6 = 1200 tall — wide enough for the task list at the
           sidenav-collapsed width, tall enough that the seeded task rows
           dominate the frame instead of leaving a half-empty top half. */
        body[data-sp-video-variant="shorts"] app-root {
          zoom: 1.6;
        }
        /* Mobile (1080x2340 phone aspect): SP's responsive layout already
           collapses the sidenav and switches to a touch-friendly toolbar
           when isMobile=true, so a much smaller zoom is enough. 1.0 keeps
           the layout in its native mobile breakpoint. */
        body[data-sp-video-variant="mobile"] app-root {
          zoom: 1;
        }
        /* The right-panel sizes itself to 250px (MIN_WIDTH) via
           SUP_RIGHT_PANEL_WIDTH localStorage seeded in ONBOARDING_INIT.
           No width override needed here — the panel's own resize logic
           handles sizing correctly so the schedule grid inside computes
           its column widths properly. */
        /* Hide overlays that pop on top of the add-task-bar while typing
           — these aren't "styles" on the bar itself, they're separate
           cdk-overlay surfaces that would otherwise read as glitchy
           white boxes on the gif:
           - mat-autocomplete dropdown (suggestion list)
           - mention-list (#tag and @due dropdowns from short syntax)
           - search loading spinner */
        .mat-mdc-autocomplete-panel.add-task-bar-panel,
        .cdk-overlay-pane:has(.add-task-bar-panel) {
          display: none !important;
        }
        mention-list,
        .mention-menu,
        .dropdown-menu.scrollable-menu {
          display: none !important;
        }
        add-task-bar .spinner,
        add-task-bar mat-spinner {
          display: none !important;
        }
      `;
      const attach = (): void => {
        if (!document.getElementById(style.id)) document.head.appendChild(style);
      };
      if (document.head) attach();
      else document.addEventListener('DOMContentLoaded', attach, { once: true });
    });

    page.on('pageerror', (err) => {
      console.error('[video pageerror]', err.message);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForAppReady(page);

    try {
      await use(page);
    } finally {
      // Closing the context flushes the video to disk under RECORDING_DIR.
      if (!page.isClosed()) await page.close();
      await context.close();
    }
  },

  seededPage: async ({ page, seedFile }, use) => {
    const importPage = new ImportPage(page);
    await importPage.navigateToImportPage();
    await importPage.importBackupFile(seedFile);
    await waitForAppReady(page);
    await use(page);
  },

  markBeatsStart: async ({}, use) => {
    let beatsMs: number | null = null;
    await use(() => {
      beatsMs = Date.now();
    });
    if (beatsMs == null) return;
    const offsetMs = beatsMs - recordingState.startMs;
    try {
      fs.mkdirSync(RECORDING_DIR, { recursive: true });
      fs.writeFileSync(
        TRIM_SIDECAR_PATH,
        JSON.stringify(
          {
            offsetMs,
            recordedAtMs: beatsMs,
            variant: VARIANT || 'default',
            recordingSize: VIDEO_SIZE,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.warn(`[video] failed to write trim sidecar: ${(err as Error).message}`);
    }
  },
});

export { expect } from '@playwright/test';
