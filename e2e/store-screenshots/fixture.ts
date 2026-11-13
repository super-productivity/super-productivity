/**
 * Screenshot test fixture — works in two modes selected by env var:
 *
 *   SCREENSHOT_MODE=web       (default) — Playwright Chromium context
 *                               Outputs to dist/screenshots/_master/
 *   SCREENSHOT_MODE=electron  — Real Electron build via Playwright `_electron`
 *                               Outputs to dist/screenshots/_master_electron/
 *                               Captures macOS via renderer + deterministic
 *                               traffic-light overlay, Linux via OS-level
 *                               region tool (grim / import) for GTK chrome.
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
import * as os from 'os';
import * as path from 'path';
import { ImportPage } from '../pages/import.page';
import { waitForAppReady } from '../utils/waits';
import {
  FLATHUB_SCENARIOS,
  FORCED_THEME,
  IS_NATIVE_CAPTURE,
  MASTER_DIR_ELECTRON,
  MASTER_DIR_WEB,
  MOBILE_VIEWPORTS,
  SCREENSHOT_BASE_DATE,
  type Locale,
  type Theme,
  type ViewportName,
} from './matrix';
import { compositeMacTrafficLights } from './composite-mac-chrome';
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
 * Capture the focused Electron window.
 *
 * macOS: use renderer capture and add hiddenInset traffic lights
 * deterministically. Playwright's `_electron.launch` does not always get the
 * same AppKit treatment as a LaunchServices-started `.app`, and OS-level
 * capture can miss the button overlay even when the content is correct.
 *
 * Linux: capture the full screen-space rect, including native GTK decoration.
 *
 * On Linux, `BrowserWindow.getBounds()` returns the outer frame in pixels, and
 * the matching OS tool produces 1:1 output.
 *
 * If the Linux OS-level capture fails, we fall back to `page.screenshot()` so
 * the rest of the single-session run still produces output. The fallback PNG
 * won't include native GTK chrome, but every other scene downstream of the
 * failure is salvaged.
 */
const captureWindowWithChrome = async (
  electronApp: ElectronApplication,
  page: Page,
  outPath: string,
): Promise<void> => {
  if (process.platform === 'darwin') {
    await page.screenshot({
      path: outPath,
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    });
    await compositeMacTrafficLights(outPath);
    return;
  }

  try {
    // Beat for focus + paint to settle before the OS-level capture fires.
    const settleAndCapture = async (bin: string, args: string[]): Promise<void> => {
      await new Promise((r) => setTimeout(r, 300));
      console.log(`[screenshot] ${path.basename(outPath)} → ${bin} ${args.join(' ')}`);
      try {
        // execFile bypasses the shell — no quoting concerns, no metachar escapes.
        await run(bin, args, { env: { ...process.env, ...SANDBOX_HOME_OVERRIDES } });
      } catch (err) {
        // execFile throws { message, code, stdout, stderr }; surface stderr
        // because the default Error message just says "Command failed: …" and
        // hides the actual cause from the OS capture tool.
        const e = err as { stderr?: string; stdout?: string; message?: string };
        const stderr = (e.stderr ?? '').toString().trim();
        const stdout = (e.stdout ?? '').toString().trim();
        const tail = [stderr && `stderr: ${stderr}`, stdout && `stdout: ${stdout}`]
          .filter(Boolean)
          .join('; ');
        throw new Error(
          tail
            ? `${e.message ?? 'capture failed'} (${tail})`
            : (e.message ?? String(err)),
        );
      }
    };

    // ─── Linux: capture by screen rect (no per-window equivalent
    //      that's guaranteed to be on PATH). Output dims will match the
    //      window outer bounds. ─────────────────────────────────────────
    const b = await electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!w) throw new Error('No Electron window to capture');
      w.show();
      w.focus();
      return w.getBounds();
    });

    for (const v of [b.x, b.y, b.width, b.height]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Non-finite window bound: ${JSON.stringify(b)}`);
      }
    }

    const isWayland =
      process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    const [bin, args] = isWayland
      ? ['grim', ['-g', `${b.x},${b.y} ${b.width}x${b.height}`, outPath]]
      : [
          'import',
          ['-window', 'root', '-crop', `${b.width}x${b.height}+${b.x}+${b.y}`, outPath],
        ];
    await settleAndCapture(bin, args);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (!osChromeCaptureWarned) {
      osChromeCaptureWarned = true;
      const hint =
        process.platform === 'linux'
          ? '\n  ↳ Linux: ensure `grim` (Wayland) or ImageMagick `import` (X11) ' +
            'is installed and on PATH.'
          : '';
      console.warn(
        '\n' +
          '════════════════════════════════════════════════════════════════════\n' +
          '⚠  OS-LEVEL SCREEN CAPTURE FAILED — RENDERER FALLBACK ACTIVE\n' +
          '════════════════════════════════════════════════════════════════════\n' +
          `  ${msg.split('\n')[0]}\n` +
          '  Captures will NOT include native GTK window chrome. The Flathub\n' +
          '  deliverables from this run are therefore NOT submission-ready.' +
          hint +
          '\n' +
          '════════════════════════════════════════════════════════════════════\n',
      );
      // Marker so the globalTeardown can re-surface this at the end of the
      // run — the warning above scrolls off in long runs and the user
      // notices the missing chrome only when reviewing the PNGs.
      try {
        fs.mkdirSync(MASTER_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(MASTER_DIR, '.os-capture-failed'),
          `${new Date().toISOString()}\n${msg}\n`,
        );
      } catch {
        /* marker is best-effort */
      }
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

/** How long GNOME capture waits for the user's Alt+Print in one scene. */
const GNOME_WAIT_MS = 300_000;
let gnomeShotIndex = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Root folder to watch for GNOME screenshots. GNOME Shell saves to
 * `$(xdg-user-dir PICTURES)/<localized "Screenshots">` (e.g. `Bildschirmfotos`
 * on a German desktop), so we watch the Pictures folder and its direct
 * subfolders rather than guessing the translated name.
 */
const gnomeScreenshotRoot = async (): Promise<string> => {
  const override = process.env.SP_SCREENSHOT_GNOME_DIR?.trim();
  if (override) return override;
  try {
    const { stdout } = await run('xdg-user-dir', ['PICTURES']);
    const pictures = stdout.toString().trim();
    if (pictures) return pictures;
  } catch {
    /* xdg-user-dir missing: fall back to the default location */
  }
  return path.join(os.homedir(), 'Pictures');
};

/** Absolute paths of all PNGs in `root` and its direct subfolders. */
const listPngs = (root: string): string[] => {
  const out: string[] = [];
  const scan = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) scan(p, depth - 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) out.push(p);
    }
  };
  scan(root, 1);
  return out;
};

const currentDesktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toUpperCase();
const IS_KDE = currentDesktop.includes('KDE');
const IS_GNOME = currentDesktop.includes('GNOME');

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (file: string): { width: number; height: number } => {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, header, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

/**
 * KDE capture: raise and focus the window, then let Spectacle grab the active
 * window in the background. Spectacle includes KWin's title bar, rounded
 * corners and shadow (per its "Include window titlebar/shadow" settings).
 */
const captureViaSpectacle = async (
  electronApp: ElectronApplication,
  outPath: string,
  scenario: string,
): Promise<void> => {
  const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!w) throw new Error('No Electron window to capture');
    w.show();
    w.moveTop();
    w.focus();
    return w.getBounds();
  });
  // Let KWin finish activating the window and the renderer finish painting.
  await sleep(800);
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  console.log(`[screenshot] ${scenario} → spectacle --activewindow`);
  await run('spectacle', [
    '--background',
    '--nonotify',
    '--activewindow',
    '--output',
    outPath,
  ]);
  if (!fs.existsSync(outPath)) {
    throw new Error(`Spectacle did not write ${outPath} for ${scenario}`);
  }
  // Sanity check: the capture should be the app window (plus title bar and
  // shadow), not e.g. the terminal that happened to keep focus.
  const size = pngSize(outPath);
  const ratio = size.width / size.height / (bounds.width / bounds.height);
  if (ratio < 0.85 || ratio > 1.15) {
    throw new Error(
      `${scenario}: captured ${size.width}x${size.height}, but the app window is ` +
        `${bounds.width}x${bounds.height}. Was another window active? Keep the ` +
        'Super Productivity window in front while the capture runs.',
    );
  }
};

/**
 * GNOME capture: bring the window forward, ask the user to press Alt+Print
 * (GNOME's native window screenshot, with decoration, rounded corners and
 * shadow), then copy the new PNG from the screenshots folder to `outPath`.
 */
const captureViaGnome = async (
  electronApp: ElectronApplication,
  outPath: string,
  scenario: string,
): Promise<void> => {
  const dir = await gnomeScreenshotRoot();
  const before = new Set(listPngs(dir));

  await electronApp
    .evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      w?.show();
      w?.focus();
    })
    .catch(() => undefined);

  gnomeShotIndex += 1;
  console.log(
    `\n📸 [${gnomeShotIndex}/${FLATHUB_SCENARIOS.length}] ${scenario}\n` +
      '   Click the Super Productivity title bar, then press Alt+Print.\n' +
      `   Waiting for a new PNG in ${dir} (or a folder directly inside it) …`,
  );

  const deadline = Date.now() + GNOME_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    const fresh = listPngs(dir).filter((p) => !before.has(p));
    if (!fresh.length) continue;
    const src = fresh[0];
    console.log(`   ↳ found ${src}`);
    // GNOME writes the file asynchronously; wait until its size settles.
    let lastSize = -1;
    for (let i = 0; i < 20; i++) {
      const size = fs.statSync(src).size;
      if (size > 0 && size === lastSize) break;
      lastSize = size;
      await sleep(250);
    }
    fs.copyFileSync(src, outPath);
    console.log(`   ✓ saved ${path.relative(process.cwd(), outPath)}`);
    return;
  }
  throw new Error(
    `No new screenshot appeared in ${dir} or its subfolders within ` +
      `${GNOME_WAIT_MS / 1000}s for ${scenario}. Set SP_SCREENSHOT_GNOME_DIR ` +
      'if GNOME saves elsewhere.',
  );
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
  customTheme: [
    process.env.SCREENSHOT_CUSTOM_THEME?.trim() || undefined,
    { option: true },
  ] as never,

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
    // Native capture: start with the system title bar so the desktop draws
    // real decoration and shadow. main-window.ts reads this before the
    // window exists; the seed sets the matching renderer config.
    if (IS_NATIVE_CAPTURE) {
      fs.writeFileSync(
        path.join(userDataDir, 'simpleSettings'),
        JSON.stringify({ isUseCustomWindowTitleBar: false }),
      );
    }

    // NODE_ENV is intentionally NOT set to 'DEV': start-app.js binds
    // `isShowDevTools = IS_DEV`, and electron/debug.ts auto-opens DevTools on
    // every `dom-ready` (so reloads between scenarios re-open them too).
    // Loading the dev server is governed by --custom-url, not IS_DEV, so we
    // can safely run with IS_DEV=false and keep the same URL.
    // `--no-sandbox` and `--disable-dev-shm-usage` are Linux/CI helper
    // flags. On macOS they're not needed, and `--no-sandbox` in particular
    // appears to suppress the hiddenInset traffic-lights when Electron is
    // launched as a child process (the same binary launched via `npm start`
    // shows them fine). Only pass them on Linux.
    const isMac = process.platform === 'darwin';
    const deviceScaleFactor =
      (testInfo.project.use as { deviceScaleFactor?: number }).deviceScaleFactor ?? 1;
    const electronApp = await _electron.launch({
      args: [
        ELECTRON_MAIN,
        `--custom-url=http://localhost:4242/`,
        `--user-data-dir=${userDataDir}`,
        ...(isMac ? [`--force-device-scale-factor=${deviceScaleFactor}`] : []),
        ...(isMac ? [] : ['--disable-dev-shm-usage', '--no-sandbox']),
      ],
      env: {
        ...process.env,
        NODE_ENV: 'PROD',
        // Tells main-window.ts to set `enableLargerThanScreen: true` so the
        // configured 1280×800 outer bounds aren't silently clamped to fit
        // available screen area below menu bar + dock. Without this, on
        // laptop displays setBounds(800) ends up as 780 and the captured
        // PNG fails Mac App Store dimension validation.
        SP_SCREENSHOT_MODE: '1',
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
      const achieved = await electronApp
        .evaluate(
          ({ BrowserWindow }, size) => {
            try {
              const w =
                BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
              if (!w) return null;
              w.setBounds({ x: 0, y: 0, width: size.w, height: size.h });
              if (w.webContents.isDevToolsOpened()) {
                w.webContents.closeDevTools();
              }
              // Report what setBounds actually achieved vs. requested. On
              // macOS the OS may push y below the menu bar / shrink to fit
              // the screen; the result tells us whether 1280×800 stuck.
              return {
                bounds: w.getBounds(),
                contentBounds: w.getContentBounds(),
              };
            } catch {
              /* swallow — bounds/devtools are nice-to-have, not critical */
              return null;
            }
          },
          { w: targetSize.width, h: targetSize.height },
        )
        .catch(() => null);
      if (achieved) {
        const b = achieved.bounds;
        const c = achieved.contentBounds;
        console.log(
          `[screenshot] setBounds requested=${targetSize.width}x${targetSize.height} → ` +
            `outer=${b.x},${b.y} ${b.width}x${b.height}; ` +
            `content=${c.x},${c.y} ${c.width}x${c.height}`,
        );
      }
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
        { darkMode: FORCED_THEME ?? theme, customThemeId: customTheme },
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
        // Phones open the schedule in the day view unless a view was picked;
        // the store shot shows the week grid.
        localStorage.setItem('SELECTED_TIME_VIEW', 'week');
      });
    }
    await page.addInitScript((darkMode) => {
      try {
        localStorage.setItem('DARK_MODE', darkMode);
      } catch {
        /* noop */
      }
    }, FORCED_THEME ?? theme);
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
    const showSyncReadyState = async (): Promise<void> => {
      await page.evaluate(async () => {
        // Screenshots run without a sync provider. Show the in-sync icon
        // instead of `sync_off`, as a configured install would. Fetched the
        // same way the app loads its built-in SVG icons.
        const icon = document.querySelector('.sync-btn mat-icon');
        if (!icon) return;
        const res = await fetch('assets/icons/sync-done.svg');
        if (res.ok) icon.innerHTML = await res.text();
      });
    };
    const fn = async (scenario: string, name: string): Promise<void> => {
      // GNOME capture only stops for scenes that end up in the Flathub gallery.
      if (IS_NATIVE_CAPTURE && !FLATHUB_SCENARIOS.includes(scenario)) return;
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
        await showSyncReadyState();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(120);
      } catch {
        /* electron pages with no mouse host shouldn't ever fail this */
      }
      if (MODE === 'electron' && electronApp && IS_NATIVE_CAPTURE && IS_KDE) {
        await captureViaSpectacle(electronApp, file, scenario);
      } else if (MODE === 'electron' && electronApp && IS_NATIVE_CAPTURE && IS_GNOME) {
        await captureViaGnome(electronApp, file, scenario);
      } else if (MODE === 'electron' && electronApp) {
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
