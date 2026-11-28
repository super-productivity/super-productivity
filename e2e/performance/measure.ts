/**
 * In-page timing. Every timestamp is taken inside the page on the
 * `performance.now()` clock, so Playwright's polling, auto-waits and IPC are
 * never part of a measurement.
 *
 * - Start: the capture-phase `event.timeStamp` of the real input event (same
 *   clock as `performance.now()` in Chromium), or the navigation start (0) for
 *   a reload.
 * - Ready: the first mutation batch after which the scenario's DOM predicate
 *   holds.
 * - Frame: a task queued from the next animation frame, i.e. after the frame
 *   following "ready" had its chance to render. This is a DOM response latency
 *   proxy, not INP or a presented-pixel time.
 */
import type { Page } from '@playwright/test';

export interface ReadySpec {
  /** Selectors that must match a rendered element. */
  present: string[];
  /** Selectors that must match nothing (e.g. rows of the previous view). */
  absent: string[];
  /** Exact text that must appear inside a rendered `task` row. */
  taskTitle?: string;
}

export interface Timing {
  start: number;
  ready: number;
  frame: number;
}

interface PerfWindow {
  __perfArm: (spec: ReadySpec, startEvent: string | null) => void;
  __perfResult?: Promise<Timing>;
}

const RELOAD_FLAG = '__perfReloadSpec';
const TIMEOUT_MS = 30_000;

/**
 * Installed with `context.addInitScript` so the same code arms interactions and
 * reloads. Self-contained: Playwright serializes it into the page.
 */
const perfInit = (cfg: {
  injectDelayMs: number;
  reloadFlag: string;
  timeoutMs: number;
}): void => {
  if (window !== window.top) return;
  const w = window as unknown as PerfWindow;

  const isRendered = (el: Element | null): boolean =>
    !!el && el.isConnected && el.checkVisibility();

  w.__perfArm = (spec, startEvent) => {
    let start: number | null = startEvent ? null : 0;
    let titleCandidate: Element | null = null;
    const armedAt = performance.now();

    const titleIsRendered = (): boolean => {
      if (!spec.taskTitle) return true;
      return isRendered(titleCandidate?.closest('task') ?? null);
    };
    const isReady = (): boolean =>
      start !== null &&
      titleIsRendered() &&
      spec.present.every((s) => isRendered(document.querySelector(s))) &&
      spec.absent.every((s) => !document.querySelector(s));

    // Only scan nodes that changed, so the predicate stays cheap on long lists.
    const noteTitle = (node: Node): void => {
      if (!spec.taskTitle || !node.textContent?.includes(spec.taskTitle)) return;
      const el = node instanceof Element ? node : node.parentElement;
      if (!el) return;
      titleCandidate = el.closest('task')
        ? el
        : (Array.from(el.querySelectorAll('task')).find((t) =>
            t.textContent?.includes(spec.taskTitle!),
          ) ?? null);
    };

    w.__perfResult = new Promise<Timing>((resolve, reject) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`perf: endpoint not reached (${JSON.stringify(spec)})`));
      }, cfg.timeoutMs);
      const finish = (): void => {
        const ready = performance.now();
        observer.disconnect();
        clearTimeout(timer);
        requestAnimationFrame(() =>
          setTimeout(() => resolve({ start: start!, ready, frame: performance.now() })),
        );
      };
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'characterData') noteTitle(r.target);
          r.addedNodes.forEach(noteTitle);
        }
        if (isReady()) finish();
      });
      observer.observe(document, { subtree: true, childList: true, characterData: true });

      if (startEvent) {
        const onStart = (ev: Event): void => {
          if (startEvent === 'keydown' && (ev as KeyboardEvent).key !== 'Enter') return;
          window.removeEventListener(startEvent, onStart, true);
          if (ev.timeStamp < armedAt) {
            reject(new Error(`perf: ${startEvent} timestamp precedes arming`));
            return;
          }
          start = ev.timeStamp;
          // Controlled slowdown used to prove the harness detects regressions.
          const until = performance.now() + cfg.injectDelayMs;
          while (performance.now() < until) {
            // busy wait on purpose
          }
        };
        window.addEventListener(startEvent, onStart, true);
      }
    });
  };

  const reloadSpec = sessionStorage.getItem(cfg.reloadFlag);
  if (reloadSpec) {
    sessionStorage.removeItem(cfg.reloadFlag);
    w.__perfArm(JSON.parse(reloadSpec) as ReadySpec, null);
  }
};

export const installPerfInit = async (
  page: Page,
  injectDelayMs: number,
): Promise<void> => {
  await page.addInitScript(perfInit, {
    injectDelayMs,
    reloadFlag: RELOAD_FLAG,
    timeoutMs: TIMEOUT_MS,
  });
};

/** Arm before the input; the start is the next `startEvent` the page receives. */
export const armInteraction = async (
  page: Page,
  spec: ReadySpec,
  startEvent: 'click' | 'keydown',
): Promise<void> => {
  await page.evaluate(([s, e]) => (window as unknown as PerfWindow).__perfArm(s, e), [
    spec,
    startEvent,
  ] as const);
};

/** Reloads the page and measures from navigation start to `spec`. */
export const reloadAndArm = async (page: Page, spec: ReadySpec): Promise<void> => {
  await page.evaluate(([key, s]) => sessionStorage.setItem(key, s), [
    RELOAD_FLAG,
    JSON.stringify(spec),
  ] as const);
  await page.reload({ waitUntil: 'commit' });
};

export const collectTiming = async (page: Page): Promise<Timing> => {
  await page.waitForFunction(
    () => !!(window as unknown as PerfWindow).__perfResult,
    undefined,
    { timeout: TIMEOUT_MS },
  );
  return page.evaluate(() => (window as unknown as PerfWindow).__perfResult!);
};
