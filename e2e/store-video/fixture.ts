/**
 * Video pipeline fixture. Mirrors the web-mode setup of the screenshot fixture
 * (`e2e/store-screenshots/fixture.ts`) but creates its own browser context
 * with `recordVideo` enabled, since `browser.newContext()` does not inherit
 * the project's `use.video` setting.
 *
 * Recording lands in `.tmp/video/recordings/<random>.webm` after the page
 * closes; `build-video.ts` picks the most recent one.
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
const RECORDING_DIR = path.join(REPO_ROOT, '.tmp', 'video', 'recordings');
const TRIM_SIDECAR_PATH = path.join(RECORDING_DIR, '_latest-trim.json');

// Viewport == recording size, otherwise Playwright pads the smaller axis with
// gray. Square 1024×1024 plays well on social embeds and matches the rhythm
// of the GitHub README. deviceScaleFactor 2 renders the page at 2× physical
// pixels (2048×2048) which Playwright then downsamples into 1024×1024 —
// sharp text on the gif. Cost: ~2× CPU/memory during capture.
const VIDEO_SIZE = { width: 1024, height: 1024 } as const;
const DEVICE_SCALE_FACTOR = 2;

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
    const context = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:4242',
      userAgent: `PLAYWRIGHT-VIDEO-${testInfo.workerIndex}`,
      storageState: undefined,
      // Pin navigator.language so ImportPage's English text matchers work
      // regardless of host locale. UI locale is switched after seed import.
      locale: 'en-US',
      viewport: VIDEO_SIZE,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      recordVideo: {
        dir: RECORDING_DIR,
        size: VIDEO_SIZE,
      },
    });
    const page = await context.newPage();

    await page.clock.install({ time: SCREENSHOT_BASE_DATE });

    await page.addInitScript(ONBOARDING_INIT);
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
    // Inject a soft ring that follows the cursor — at 1024×1024 the OS
    // pointer is small and easy to miss; this makes drag motions read on
    // the gif. The ring is at z-index 2147483640 (under the full-screen
    // cards which sit higher) so it's automatically hidden during beat 4/5.
    // Spec code can also toggle visibility per-beat by adding/removing the
    // `__sp-hide-cursor-highlight` class on body — used during the capture
    // beat where the cursor sits in the middle of the focused input and
    // would otherwise read as a stray white dot.
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
        /* Hide every Material dialog that would modal over the reel —
           reminders, scheduling confirmation, anything else. The reel
           doesn't legitimately need any modal, and per-selector :has()
           rules kept missing variants. Targeting the dialog container
           class catches them all. focus-mode-overlay is its own element,
           not a mat-dialog, so it's unaffected. */
        .cdk-overlay-pane:has(.mat-mdc-dialog-container),
        .cdk-overlay-pane:has(mat-dialog-container) {
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
        JSON.stringify({ offsetMs, recordedAtMs: beatsMs }, null, 2),
      );
    } catch (err) {
      console.warn(`[video] failed to write trim sidecar: ${(err as Error).message}`);
    }
  },
});

export { expect } from '@playwright/test';
