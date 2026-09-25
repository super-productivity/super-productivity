/**
 * Video pipeline fixture. Mirrors the web-mode setup of the screenshot fixture
 * (`e2e/store-screenshots/fixture.ts`) but creates its own browser context and
 * records it with the video-kit recorder (device pixels, near-lossless).
 *
 * Recording lands in a variant directory such as
 * `.tmp/video/recordings/default/<timestamp>.mkv`;
 * `build-video.ts` picks the most recent successful one for the same variant.
 *
 * Trim handling: the recording necessarily includes ~16s of seed-import
 * navigation before the choreographed beats begin. Offsets are measured from
 * the recording's start; the spec calls `markBeatsStart()` once seeded and
 * ready. After a successful test stops the recording, its trim data is
 * written beside that exact file. Failed captures have no trim sidecar.
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
import { installCursor, installTapRipple, onSceneStart } from '../video-kit';
import { startRecording } from '../video-kit/recorder';
import { RECORDING_EXT, trimPathFor } from '../video-kit/render';
import { enableAnimations } from './helpers';
import { RECORDING_SIZE, VIDEO_PROFILE } from './profile';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SEED_DIR = path.join(REPO_ROOT, '.tmp', 'video-seeds');
const VARIANT = process.env.REEL_VARIANT ?? '';
const RECORDINGS_DIR = path.join(REPO_ROOT, '.tmp', 'video', 'recordings');
const variantDirName = (VARIANT || 'default').replace(/[^a-z0-9_-]+/gi, '-');
const RECORDING_DIR = path.join(RECORDINGS_DIR, variantDirName);

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
   * recording's lead-in. The sidecar also records where the test body ended
   * (teardown is trimmed off) and when each labeled `cutToScene` revealed its
   * scene (printed by the build and used for the contact sheet).
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

type TrimSidecar = {
  offsetMs: number;
  endOffsetMs: number;
  scenes: { label: string; offsetMs: number }[];
  recordedAtMs: number;
  variant: string;
  recordingSize: { width: number; height: number };
};

// The config uses one worker. The page fixture writes the sidecar only after
// the recorder flushes; markBeatsStart provides its trim data first.
const recordingState: { startMs: number; trim?: TrimSidecar } = { startMs: 0 };

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

  // Override the default page fixture: the video context needs its own
  // viewport, locale and user agent, and is recorded from its first page.
  page: async ({ browser, baseURL, theme, locale }, use, testInfo) => {
    recordingState.trim = undefined;
    const isMobile = VARIANT === 'mobile';
    const context = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:4242',
      userAgent: isMobile
        ? `Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 PLAYWRIGHT-VIDEO-${testInfo.workerIndex}`
        : `PLAYWRIGHT-VIDEO-${testInfo.workerIndex}`,
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
    });
    const page = await context.newPage();
    fs.mkdirSync(RECORDING_DIR, { recursive: true });
    const recordingPath = path.join(
      RECORDING_DIR,
      `${new Date().toISOString().replace(/[:.]/g, '-')}${RECORDING_EXT}`,
    );
    const recording = await startRecording(page, {
      path: recordingPath,
      size: RECORDING_SIZE,
    });
    recordingState.startMs = recording.startedAtMs;

    await page.clock.install({ time: SCREENSHOT_BASE_DATE });

    await page.addInitScript(ONBOARDING_INIT);
    await page.addInitScript((variant) => {
      if (variant === 'updates') {
        localStorage.setItem('SUP_RIGHT_PANEL_WIDTH', '500');
      }
      // Stash variant on body so injected styles / scenarios can branch via
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
    // Headless recordings draw no cursor, so clicks and taps would read as
    // state changes with no on-frame cause. Touch variants mark taps instead.
    // The existing reels were tuned around the soft ring; newer ones use the arrow.
    if (isMobile) {
      await installTapRipple(page);
    } else {
      await installCursor(page, { style: VARIANT === 'updates' ? 'arrow' : 'ring' });
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
           mat-dialog, so it's unaffected. The backdrop goes too: it would
           otherwise dim the whole frame, e.g. behind a reminder dialog. */
        body:not([data-sp-video-variant="updates"]) .cdk-overlay-pane:has(.mat-mdc-dialog-container):not(:has(dialog-import-encryption-warning)),
        body:not([data-sp-video-variant="updates"]) .cdk-overlay-pane:has(mat-dialog-container):not(:has(dialog-import-encryption-warning)),
        body:not([data-sp-video-variant="updates"])
          .cdk-overlay-backdrop:has(+ .cdk-overlay-pane mat-dialog-container):not(:has(+ .cdk-overlay-pane dialog-import-encryption-warning)) {
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
        body[data-sp-video-variant="updates"] app-root {
          zoom: 1.7;
        }
        /* Shorts (9:16, 1080x1920): zoom up further so the work-view fills
           the portrait canvas. The inner viewport is 1080/1.6 = 675 wide,
           1920/1.6 = 1200 tall — wide enough for the task list at the
           sidenav-collapsed width, tall enough that the seeded task rows
           dominate the frame instead of leaving a half-empty top half. */
        body[data-sp-video-variant="shorts"] app-root {
          zoom: 1.6;
        }
        /* Mobile and hero use small CSS viewports that activate SP's
           responsive layouts; DPR, not zoom, gives them their pixels. */
        body[data-sp-video-variant="mobile"] app-root,
        body[data-sp-video-variant="hero"] app-root,
        body[data-sp-video-variant="hero-light"] app-root {
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
        /* The end card's platforms line (third stat) is much longer than the
           counters above it; one step smaller keeps it on a single line. */
        .vk-end-card-stat:nth-child(3) {
          font-size: clamp(24px, 2.2vw, 38px);
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
      try {
        await recording.stop();
      } finally {
        if (!page.isClosed()) await page.close();
        await context.close();
      }
      if (testInfo.status === 'passed' && recordingState.trim) {
        fs.writeFileSync(
          trimPathFor(recordingPath),
          JSON.stringify(recordingState.trim, null, 2),
        );
      }
    }
  },

  seededPage: async ({ page, seedFile }, use) => {
    const importPage = new ImportPage(page);
    await importPage.navigateToImportPage();
    await importPage.importBackupFile(seedFile);
    await waitForAppReady(page);
    await enableAnimations(page);
    await use(page);
  },

  markBeatsStart: async ({ page }, use) => {
    let beatsMs: number | null = null;
    const scenes: { label: string; offsetMs: number }[] = [];
    onSceneStart(page, (label) => {
      scenes.push({ label, offsetMs: Date.now() - recordingState.startMs });
    });
    await use(() => {
      beatsMs = Date.now();
    });
    // Runs right after the test body, before the page fixture closes the
    // context, so the recorded teardown stays out of the video.
    const endOffsetMs = Date.now() - recordingState.startMs;
    if (beatsMs == null) return;
    const offsetMs = beatsMs - recordingState.startMs;
    recordingState.trim = {
      offsetMs,
      endOffsetMs,
      scenes,
      recordedAtMs: beatsMs,
      variant: VARIANT || 'default',
      recordingSize: RECORDING_SIZE,
    };
  },
});

export { expect } from '@playwright/test';
