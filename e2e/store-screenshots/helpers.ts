/**
 * Scenario helpers — UI mechanics for driving the app to specific states.
 * Each helper assumes the app has already been seeded (via `seededPage`).
 *
 * Platform gating is done at the Playwright config level via per-project
 * `testMatch` (desktop projects load `scenarios/desktop/**`, mobile projects
 * load `scenarios/mobile/**`), so specs no longer need a runtime `onlyOn`.
 */

import type { Page } from '@playwright/test';
import { waitForAppReady } from '../utils/waits';

/**
 * Toggle the right-hand notes panel. Selector from
 * `desktop-panel-buttons.component.ts` (`.e2e-toggle-notes-btn`) — desktop
 * only, since mobile uses a different bottom-nav flow.
 */
export const openNotesPanel = async (page: Page): Promise<void> => {
  const btn = page.locator('.e2e-toggle-notes-btn').first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
};

/** Toggle the schedule day panel via the e2e-tagged header button. */
export const openSchedulePanel = async (page: Page): Promise<void> => {
  const btn = page.locator('.e2e-toggle-schedule-day-panel').first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
};

/** Toggle the issue provider panel via the e2e-tagged header button. */
export const openIssueProviderPanel = async (page: Page): Promise<void> => {
  const btn = page.locator('.e2e-toggle-issue-provider-panel').first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
};

/** Open the right-hand task detail panel for a known seeded task id. */
export const openTaskDetailPanel = async (page: Page, taskId: string): Promise<void> => {
  await dispatchInPage(page, {
    type: '[Task] SetSelectedTask',
    id: taskId,
    taskDetailTargetPanel: 'Default',
    isSkipToggle: true,
  });
  await page.locator('right-panel-content task-detail-panel').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
};

/**
 * Nudge the schedule's scroll container up by `pxUp` pixels so the
 * captured frame shows a bit of context before work-start (default
 * scroll lands flush at work-start, which crops anything earlier in the
 * day). Pass through to the schedule scroll-wrapper rather than the
 * page scroll so we don't disturb non-schedule layouts.
 */
export const scrollScheduleUp = async (page: Page, pxUp = 80): Promise<void> => {
  await page.evaluate((delta) => {
    const wrapper = document.querySelector(
      'schedule .scroll-wrapper, schedule-week .scroll-wrapper, .scroll-wrapper',
    ) as HTMLElement | null;
    if (!wrapper) return;
    wrapper.scrollTop = Math.max(0, wrapper.scrollTop - delta);
  }, pxUp);
  // Beat for sticky-header repaint to settle before the capture fires.
  await page.waitForTimeout(120);
};

/** Standard scenario boot: navigate to a hash route + settle. */
export const gotoAndSettle = async (page: Page, hashRoute: string): Promise<void> => {
  await page.goto(hashRoute);
  await waitForAppReady(page, { ensureRoute: false });
  // Tail buffer for router/animation transitions.
  await page.waitForTimeout(400);
};

/**
 * Reset transient UI state between scenarios in a grouped run. The seed lives
 * in IndexedDB so it survives — only in-memory NgRx + open panels/dialogs are
 * reset. `page.reload()` is the cheapest reliable reset.
 */
export const resetView = async (page: Page): Promise<void> => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, { ensureRoute: false });
  await page.waitForTimeout(200);
};

/**
 * Switch DARK_MODE without re-importing the seed. Lets a single test session
 * capture both light and dark scenarios — saves ~30 s/spec/locale.
 *
 * Implementation: Playwright's `addInitScript` is append-only. The last
 * registered script runs last on every subsequent navigation, so layering a
 * new DARK_MODE setter on top of the fixture's initial setter wins from here
 * on. We then reload so GlobalThemeService picks up the new value at boot.
 */
export const applyTheme = async (page: Page, theme: 'dark' | 'light'): Promise<void> => {
  await page.addInitScript((darkMode) => {
    try {
      localStorage.setItem('DARK_MODE', darkMode);
    } catch {
      /* noop */
    }
  }, theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, { ensureRoute: false });
  await page.waitForTimeout(200);
};

/**
 * Dispatch an NgRx action via `window.__e2eTestHelpers.store` (exposed in
 * dev/stage builds — see src/main.ts). Throws if the helper isn't present so
 * the pipeline fails loudly instead of silently capturing the wrong locale.
 */
const dispatchInPage = async (page: Page, action: unknown): Promise<void> => {
  await page.evaluate((act) => {
    type Helpers = {
      store?: { dispatch: (a: unknown) => void };
    };
    const helpers = (window as unknown as { __e2eTestHelpers?: Helpers })
      .__e2eTestHelpers;
    if (!helpers?.store) {
      throw new Error(
        '__e2eTestHelpers.store missing — run against a dev/stage build of SP',
      );
    }
    helpers.store.dispatch(act);
  }, action);
};

/**
 * Switch locale without re-importing the seed. Drives the same code path the
 * import flow does: dispatch `[Global Config] Update Global Config Section`
 * on `localization.lng`. The `applyLanguageFromState$` effect picks up the
 * change and calls LanguageService.setLng().
 */
export const applyLocale = async (page: Page, lng: string): Promise<void> => {
  await dispatchInPage(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey: 'localization',
    sectionCfg: { lng },
    isSkipSnack: true,
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'localization',
      opType: 'UPDATE',
    },
  });
  // Stamp on window so the screenshotMaster fixture can route captures into
  // the correct `<locale>/` subdir without re-querying the store.
  await page.addInitScript((l) => {
    (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale = l;
  }, lng);
  await page.evaluate((l) => {
    (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale = l;
  }, lng);
  // ngx-translate fetches the i18n bundle on demand; give it a moment to
  // resolve before the next screenshot.
  await page.waitForTimeout(600);
  await waitForAppReady(page, { ensureRoute: false });
};

/**
 * Inject a marketing caption overlay over the current scene. Used for the
 * cover/hero slot — translucent gradient strip with a bold headline + thin
 * subline; app remains visible behind as the proof point. Position is
 * orientation-aware: landscape captures get the strip at the bottom (typical
 * desktop hero), portrait captures get it at the top (where mobile users
 * already track their gaze). Removed automatically on the next reload.
 */
export const showMarketingOverlay = async (
  page: Page,
  headline: string,
  subline?: string,
): Promise<void> => {
  await page.evaluate(
    ({ h, s }) => {
      const id = '__sp-marketing-overlay';
      document.getElementById(id)?.remove();
      const isLandscape = window.innerWidth >= window.innerHeight;
      const edgeRule = isLandscape ? 'bottom:0' : 'top:0';
      const gradientDir = isLandscape ? 'to top' : 'to bottom';
      // Slightly more padding on the gradient's "fade away" side so the text
      // sits visually anchored to the screen edge.
      const padding = isLandscape ? '8vh 6vw 6vh 6vw' : '6vh 6vw 8vh 6vw';
      const overlay = document.createElement('div');
      overlay.id = id;
      overlay.style.cssText = [
        'position:fixed',
        edgeRule,
        'left:0',
        'right:0',
        `padding:${padding}`,
        `background:linear-gradient(${gradientDir},` +
          'rgba(0,0,0,0.92) 0%,rgba(0,0,0,0.7) 60%,rgba(0,0,0,0) 100%)',
        'color:#fff',
        'z-index:99999',
        'pointer-events:none',
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
        'text-align:center',
      ].join(';');
      const head = document.createElement('div');
      head.textContent = h;
      head.style.cssText =
        'font-size:clamp(28px,4.5vw,72px);font-weight:700;letter-spacing:-0.02em;line-height:1.1';
      overlay.appendChild(head);
      if (s) {
        const sub = document.createElement('div');
        sub.textContent = s;
        sub.style.cssText =
          'font-size:clamp(15px,1.8vw,28px);font-weight:400;opacity:0.85;margin-top:0.6em';
        overlay.appendChild(sub);
      }
      document.body.appendChild(overlay);
    },
    { h: headline, s: subline },
  );
  await page.waitForTimeout(150);
};

/**
 * Flip `globalConfig.appFeatures.isTimeTrackingEnabled`. Disabling hides the
 * per-task play / pause buttons (`task-hover-controls` gates them on this
 * flag), giving the task rows a slicker, less control-heavy look. Useful for
 * mobile captures where the play column adds visual noise.
 */
export const applyTimeTrackingEnabled = async (
  page: Page,
  enabled: boolean,
): Promise<void> => {
  await dispatchInPage(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey: 'appFeatures',
    sectionCfg: { isTimeTrackingEnabled: enabled },
    isSkipSnack: true,
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'appFeatures',
      opType: 'UPDATE',
    },
  });
  await page.waitForTimeout(200);
};

/**
 * Toggle the desktop side nav between full ("expanded") and collapsed
 * ("icons-only") modes. The side nav reads `SUP_NAV_SIDEBAR_EXPANDED` from
 * localStorage on init, so we set the key and reload — hash navigation alone
 * does not re-initialize the component. Use before scenes that open a right
 * side panel to keep the main canvas readable.
 */
export const applySideNavCollapsed = async (
  page: Page,
  collapsed: boolean,
): Promise<void> => {
  await page.evaluate((isCollapsed) => {
    localStorage.setItem('SUP_NAV_SIDEBAR_EXPANDED', (!isCollapsed).toString());
  }, collapsed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, { ensureRoute: false });
  await page.waitForTimeout(200);
};

/**
 * Force the planner calendar nav into its expanded (multi-week) state.
 * The component only responds to touch gestures (no click handler), so we
 * flip its `isExpanded` signal directly via Angular's dev-mode debug
 * helpers. Requires ngDevMode (enabled by `startFrontend:e2e` / ng serve).
 */
export const setPlannerCalendarExpanded = async (
  page: Page,
  expanded: boolean,
): Promise<void> => {
  await page.evaluate((isExpanded) => {
    const nav = document.querySelector('planner-calendar-nav');
    if (!nav) throw new Error('planner-calendar-nav not found');
    type NgDebug = { getComponent?: (el: Element) => unknown };
    const ng = (window as unknown as { ng?: NgDebug }).ng;
    const cmp = ng?.getComponent?.(nav) as
      | { isExpanded?: { set: (v: boolean) => void } }
      | undefined;
    if (!cmp?.isExpanded?.set) {
      throw new Error(
        'planner-calendar-nav isExpanded signal not accessible — run against an ngDevMode build',
      );
    }
    cmp.isExpanded.set(isExpanded);
  }, expanded);
  // Settle frame so layout reflects the new state.
  await page.waitForTimeout(150);
};
