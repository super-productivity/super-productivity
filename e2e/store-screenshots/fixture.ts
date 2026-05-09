/**
 * Screenshot test fixture — works in two modes selected by env var:
 *
 *   SCREENSHOT_MODE=web       (default) — Playwright Chromium context
 *                               Outputs to .tmp/screenshots/_master/
 *   SCREENSHOT_MODE=electron  — Real Electron build via Playwright `_electron`
 *                               Outputs to .tmp/screenshots/_master_electron/
 *                               Captures via OS-level region tool
 *                               (screencapture / grim / import) so the PNG
 *                               includes the native window chrome.
 *
 * Same `seededPage` / `screenshotMaster` API in both modes, so scenarios
 * import from a single fixture file regardless of mode.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  _electron,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ImportPage } from '../pages/import.page';
import { waitForAppReady } from '../utils/waits';
import {
  MASTER_DIR_ELECTRON,
  MASTER_DIR_WEB,
  MOBILE_VIEWPORTS,
  SCREENSHOT_BASE_DATE,
  type Locale,
  type Theme,
  type ViewportName,
} from './matrix';
import { writeSeedFile } from './seed/build-seed';

const run = promisify(execFile);
const MODE: 'web' | 'electron' =
  process.env.SCREENSHOT_MODE === 'electron' ? 'electron' : 'web';

const SEED_DIR = path.resolve(__dirname, '..', '..', '.tmp', 'screenshot-seeds');
const MASTER_DIR = MODE === 'electron' ? MASTER_DIR_ELECTRON : MASTER_DIR_WEB;
const ELECTRON_MAIN = path.resolve(__dirname, '..', '..', 'electron', 'main.js');
const ELECTRON_USER_DATA = path.resolve(
  __dirname,
  '..',
  '..',
  '.tmp',
  'electron-user-data',
);
/**
 * Sandboxes / restricted shells often deny writes to `~/.config/` (Qt/KDE
 * libs, electron-log, Chromium SingletonLock all hit it). Redirect every
 * tool's config directory into a project-local path so they're happy.
 */
const SANDBOX_HOME_OVERRIDES = (() => {
  const cfg = path.resolve(__dirname, '..', '..', '.tmp', 'electron-xdg');
  fs.mkdirSync(cfg, { recursive: true });
  return {
    XDG_CONFIG_HOME: cfg,
    XDG_CACHE_HOME: cfg,
    XDG_DATA_HOME: cfg,
  } satisfies NodeJS.ProcessEnv;
})();

type ScreenshotFixtures = {
  locale: Locale;
  theme: Theme;
  customTheme: string | undefined;
  seedFile: string;
  electronApp: ElectronApplication | null;
  seededPage: Page;
  screenshotMaster: (scenario: string, name: string) => Promise<void>;
};

/**
 * Module-level latch so the noisy permission warning fires once per run, not
 * once per scene. Reset via `resetChromeFallbackWarning()` if useful in tests.
 */
let osChromeCaptureWarned = false;

/**
 * Capture the focused Electron window's full screen-space rect, including
 * native OS chrome (titlebar, traffic-lights / GTK decoration, shadow).
 * `BrowserWindow.getBounds()` returns the OUTER frame in points (macOS) or
 * pixels (Linux). The matching OS tool produces output at native resolution:
 *   - macOS Retina @2x: 1440×900 points → 2880×1800 px PNG
 *   - Linux X11/Wayland: bounds == pixels → 1:1
 *
 * If the OS-level capture fails (commonly on macOS when the terminal lacks
 * Screen Recording permission, error: "could not create image from rect"),
 * we fall back to `page.screenshot()` so the rest of the single-session run
 * still produces output. The fallback PNG won't include traffic-lights /
 * native chrome, but every other scene downstream of the failure is salvaged.
 */
const captureWindowWithChrome = async (
  electronApp: ElectronApplication,
  page: Page,
  outPath: string,
): Promise<void> => {
  try {
    const b = await electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!w) throw new Error('No Electron window to capture');
      w.show();
      w.focus();
      return w.getBounds();
    });

    // Sanity-check bounds — Electron's typings say number, but we shell out so
    // the values cross an IPC boundary. Reject anything non-finite up front
    // rather than letting it drift into the OS tool's command line.
    for (const v of [b.x, b.y, b.width, b.height]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Non-finite window bound: ${JSON.stringify(b)}`);
      }
    }

    // Beat for focus + paint to settle before the OS-level capture fires.
    await new Promise((r) => setTimeout(r, 300));

    const isWayland =
      process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    const [bin, args] =
      process.platform === 'darwin'
        ? [
            'screencapture',
            ['-R', `${b.x},${b.y},${b.width},${b.height}`, '-t', 'png', outPath],
          ]
        : isWayland
          ? ['grim', ['-g', `${b.x},${b.y} ${b.width}x${b.height}`, outPath]]
          : [
              'import',
              [
                '-window',
                'root',
                '-crop',
                `${b.width}x${b.height}+${b.x}+${b.y}`,
                outPath,
              ],
            ];
    // execFile bypasses the shell — no quoting concerns, no metachar escapes.
    await run(bin, args, { env: { ...process.env, ...SANDBOX_HOME_OVERRIDES } });
  } catch (err) {
    if (!osChromeCaptureWarned) {
      osChromeCaptureWarned = true;
      const msg = (err as Error).message ?? String(err);
      const hint =
        process.platform === 'darwin'
          ? ' On macOS, grant Screen Recording permission to your terminal ' +
            '(System Settings → Privacy & Security → Screen & System Audio Recording).'
          : '';
      console.warn(
        `[screenshot] OS-level window capture failed: ${msg.split('\n')[0]}\n` +
          `[screenshot] Falling back to renderer-only page.screenshot() for the ` +
          `rest of this run — captures will not include native window chrome.${hint}`,
      );
    }
    await page.screenshot({
      path: outPath,
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    });
  }
};

const ONBOARDING_INIT = (): void => {
  localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
  localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
  localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
  localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
};

export const test = base.extend<ScreenshotFixtures>({
  locale: ['en', { option: true }] as never,
  theme: ['light', { option: true }] as never,
  customTheme: [undefined, { option: true }] as never,

  seedFile: async ({ locale, customTheme }, use) => {
    const file = writeSeedFile(SCREENSHOT_BASE_DATE, SEED_DIR, {
      locale,
      customTheme,
    });
    await use(file);
  },

  // Electron app is launched only in electron mode; web mode resolves to null.
  electronApp: async ({}, use, testInfo) => {
    if (MODE !== 'electron') {
      await use(null);
      return;
    }
    if (!fs.existsSync(ELECTRON_MAIN)) {
      throw new Error(`${ELECTRON_MAIN} missing. Run \`npm run electron:build\` first.`);
    }
    // Per-test user-data dir avoids the singleton-lock collision and lets us
    // run inside sandboxes where ~/.config/Electron is not writable.
    const userDataDir = path.join(
      ELECTRON_USER_DATA,
      `worker-${testInfo.workerIndex}-${Date.now()}`,
    );
    fs.mkdirSync(userDataDir, { recursive: true });

    // NODE_ENV is intentionally NOT set to 'DEV': start-app.js binds
    // `isShowDevTools = IS_DEV`, and electron/debug.ts auto-opens DevTools on
    // every `dom-ready` (so reloads between scenarios re-open them too).
    // Loading the dev server is governed by --custom-url, not IS_DEV, so we
    // can safely run with IS_DEV=false and keep the same URL.
    const electronApp = await _electron.launch({
      args: [
        ELECTRON_MAIN,
        `--custom-url=http://localhost:4242/`,
        `--user-data-dir=${userDataDir}`,
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
      env: {
        ...process.env,
        NODE_ENV: 'PROD',
        ...SANDBOX_HOME_OVERRIDES,
      },
      timeout: 60_000,
    });

    try {
      await use(electronApp);
    } finally {
      // electronApp.close() can hang on apps with pending async work. Race it
      // with a force-kill, but cancel the timer if close() finishes first so
      // we don't SIGKILL a recycled PID after the process is already gone.
      const proc = electronApp.process();
      let timer: NodeJS.Timeout | undefined;
      const killAfter = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          try {
            proc?.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 8_000);
      });
      await Promise.race([electronApp.close().catch(() => undefined), killAfter]);
      if (timer) clearTimeout(timer);
    }
  },

  page: async (
    { browser, baseURL, theme, locale, customTheme, electronApp },
    use,
    testInfo,
  ) => {
    // ─── electron mode ────────────────────────────────────────────────
    if (MODE === 'electron' && electronApp) {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Pin time so day-relative seed data ("today") renders against the
      // SCREENSHOT_BASE_DATE — same behavior as the web branch below.
      await page.clock.install({ time: SCREENSHOT_BASE_DATE }).catch(() => undefined);

      // Force window size + close auto-opened DevTools now that the window
      // exists. The app's `electron-window-state` defaults to 800×800.
      // Wrapped defensively — closeDevTools throws if DevTools isn't open,
      // and any throw inside an evaluate has been observed to take down the
      // renderer.
      const targetSize = (testInfo.project.use.viewport ?? {
        width: 1440,
        height: 900,
      }) as { width: number; height: number };
      await electronApp
        .evaluate(
          ({ BrowserWindow }, size) => {
            try {
              const w =
                BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
              if (!w) return;
              w.setBounds({ x: 0, y: 0, width: size.w, height: size.h });
              if (w.webContents.isDevToolsOpened()) {
                w.webContents.closeDevTools();
              }
            } catch {
              /* swallow — bounds/devtools are nice-to-have, not critical */
            }
          },
          { w: targetSize.width, h: targetSize.height },
        )
        .catch(() => undefined);
      await page.waitForTimeout(400);

      // Electron pages have no Playwright-level baseURL, so `page.goto('/#/x')`
      // fails with "invalid URL". Wrap goto to prepend the dev server origin
      // when given a relative path — keeps shared helpers (ImportPage,
      // gotoAndSettle) working unchanged in both modes.
      const origGoto = page.goto.bind(page);
      const electronBaseURL = 'http://localhost:4242';
      (page as unknown as { goto: typeof origGoto }).goto = ((
        url: string,
        opts?: Parameters<typeof origGoto>[1],
      ) =>
        origGoto(
          url.startsWith('http') ? url : electronBaseURL + url,
          opts,
        )) as typeof origGoto;
      await page.evaluate(
        ({ darkMode, customThemeId }) => {
          try {
            localStorage.setItem('DARK_MODE', darkMode);
            localStorage.setItem('SUP_ONBOARDING_PRESET_DONE', 'true');
            localStorage.setItem('SUP_ONBOARDING_HINTS_DONE', 'true');
            localStorage.setItem('SUP_IS_SHOW_TOUR', 'true');
            localStorage.setItem('SUP_EXAMPLE_TASKS_CREATED', 'true');
            if (customThemeId) {
              localStorage.setItem('CUSTOM_THEME', `builtin:${customThemeId}`);
            }
          } catch {
            /* localStorage may be unavailable until renderer ready */
          }
        },
        { darkMode: theme, customThemeId: customTheme },
      );
      await page.evaluate(() => location.reload());
      await page.waitForLoadState('domcontentloaded');
      await waitForAppReady(page);
      // Suppress Material tooltips for the rest of the session (mirrors the
      // web-mode addInitScript). Electron has no addInitScript hook on the
      // first window, so inject after each navigation via page.on('load').
      const injectTooltipSuppress = async (): Promise<void> => {
        await page
          .evaluate(() => {
            const id = '__sp-screenshot-tooltip-suppress';
            if (document.getElementById(id)) return;
            const style = document.createElement('style');
            style.id = id;
            style.textContent =
              'mat-tooltip-component,.mat-mdc-tooltip,.cdk-overlay-container .mat-mdc-tooltip,.cdk-overlay-container .mat-tooltip,.cdk-overlay-container [role="tooltip"]{visibility:hidden!important;opacity:0!important}';
            document.head.appendChild(style);
          })
          .catch(() => undefined);
      };
      await injectTooltipSuppress();
      page.on('load', () => void injectTooltipSuppress());
      // Stamp the initial locale on window so screenshotMaster can route
      // captures into the correct `<locale>/` subdir even when applyLocale
      // hasn't run yet. Re-applied on every load so reloads don't lose it.
      const stampLocale = async (): Promise<void> => {
        await page
          .evaluate((l) => {
            (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale = l;
          }, locale)
          .catch(() => undefined);
      };
      await stampLocale();
      page.on('load', () => void stampLocale());
      page.on('pageerror', (err) => {
        console.error('[electron pageerror]', err.message);
      });
      await use(page);
      return;
    }

    // ─── web mode (default) ───────────────────────────────────────────
    const isMobileProject = (MOBILE_VIEWPORTS as readonly string[]).includes(
      testInfo.project.name,
    );
    const context = await browser.newContext({
      baseURL: baseURL ?? 'http://localhost:4242',
      userAgent: `PLAYWRIGHT PLAYWRIGHT-WORKER-${testInfo.workerIndex}`,
      storageState: undefined,
      // Pin navigator.language to en-US so ImportPage's English text matchers
      // ("Import/Export") work regardless of host locale. The actual UI locale
      // gets switched after seed import via globalConfig.localization.lng.
      locale: 'en-US',
    });
    const page = await context.newPage();

    await page.clock.install({ time: SCREENSHOT_BASE_DATE });

    await page.addInitScript(ONBOARDING_INIT);
    if (isMobileProject) {
      await page.addInitScript(() => {
        localStorage.setItem('SUP_NAV_SIDEBAR_EXPANDED', 'false');
      });
    }
    await page.addInitScript((darkMode) => {
      try {
        localStorage.setItem('DARK_MODE', darkMode);
      } catch {
        /* noop */
      }
    }, theme);
    // Mirror the DARK_MODE init script for the custom-theme picker. The
    // CustomThemeService reads LS.CUSTOM_THEME at construction; for E2E
    // screenshots we point it at a built-in theme by id (e.g. 'dracula').
    if (customTheme) {
      await page.addInitScript((id) => {
        try {
          localStorage.setItem('CUSTOM_THEME', `builtin:${id}`);
        } catch {
          /* noop */
        }
      }, customTheme);
    }
    // Stamp the initial locale on `window.__spCurrentLocale` so
    // screenshotMaster can route captures into the right `<locale>/` dir.
    // Updated by `helpers.applyLocale()` when scenes flip languages.
    await page.addInitScript((initialLocale) => {
      (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale =
        initialLocale;
    }, locale);
    // Suppress Material tooltips and CDK overlay tooltips for the duration of
    // capture. Cursor lingering at the last click position would otherwise pop
    // a tooltip into the screenshot. Setting visibility:hidden (not display)
    // keeps Angular's overlay refs valid so the app doesn't trip on missing
    // host elements.
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.id = '__sp-screenshot-tooltip-suppress';
      style.textContent = `
        mat-tooltip-component,
        .mat-mdc-tooltip,
        .cdk-overlay-container .mat-mdc-tooltip,
        .cdk-overlay-container .mat-tooltip,
        .cdk-overlay-container [role="tooltip"] {
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `;
      const attach = (): void => {
        if (!document.getElementById(style.id)) document.head.appendChild(style);
      };
      if (document.head) attach();
      else document.addEventListener('DOMContentLoaded', attach, { once: true });
    });

    page.on('pageerror', (err) => {
      console.error('[screenshot pageerror]', err.message);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForAppReady(page);

    try {
      await use(page);
    } finally {
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

  screenshotMaster: async ({ page, electronApp, locale, theme }, use, testInfo) => {
    const viewport = testInfo.project.name as ViewportName;
    const fn = async (scenario: string, name: string): Promise<void> => {
      // Read live theme + locale from the page so one test can span multiple
      // (locale × theme) variants. helpers.applyTheme flips DARK_MODE in
      // localStorage; helpers.applyLocale stamps the current locale on
      // `window.__spCurrentLocale` (set initially in fixture init scripts).
      // Both fall back to the test.use() values if the lookup fails.
      const live = await page
        .evaluate(() => ({
          theme: localStorage.getItem('DARK_MODE'),
          locale: (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale,
        }))
        .catch(() => ({ theme: null as string | null, locale: undefined }));
      const currentTheme =
        live.theme === 'light' || live.theme === 'dark' ? live.theme : theme;
      const currentLocale =
        typeof live.locale === 'string' && live.locale ? live.locale : locale;
      const dir = path.join(MASTER_DIR, viewport, currentLocale, currentTheme, scenario);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}.png`);
      // Park the cursor at (0,0) so any Material tooltip from the last click
      // dismisses (matTooltip hides on mouseleave). Also any cdk-overlay
      // tooltip that's already open is force-removed via the screenshot CSS.
      try {
        await page.mouse.move(0, 0);
        await page.waitForTimeout(120);
      } catch {
        /* electron pages with no mouse host shouldn't ever fail this */
      }
      if (MODE === 'electron' && electronApp) {
        await captureWindowWithChrome(electronApp, page, file);
      } else {
        await page.screenshot({
          path: file,
          type: 'png',
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
        });
      }
    };
    await use(fn);
  },
});

export { expect } from '@playwright/test';
