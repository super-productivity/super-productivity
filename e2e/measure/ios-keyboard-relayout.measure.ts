/**
 * Manual measurement harness for #9779 — "opening the add-task bar on iOS is
 * laggy, and it gets worse the more task rows are on screen".
 *
 * Not a performance assertion: it prints numbers and asserts only that its own
 * setup worked. It can still fail — the shared fixture throws on any uncaught
 * browser error — but it will never fail because a number got worse. Run it by
 * hand:
 *
 *   npx playwright test --config e2e/measure/playwright.measure.config.ts \
 *     --project=measure-webkit
 *
 * MEASURE_OPEN_TASK_COUNT / MEASURE_DONE_TASK_COUNT override the seeded list
 * (default 128 open + 73 done — the reporter's own Inbox).
 *
 * WHAT THIS STILL PRICES, now that #9779 is fixed. The iOS path no longer writes
 * these variables on the root: `IosKeyboardService` (`ios-keyboard.service.ts`)
 * publishes them on the CDK overlay container. The root write survives on the
 * NON-iOS path — `GlobalThemeService._initVisualViewportKeyboardTracking()`
 * (`global-theme.service.ts`) sets `--keyboard-height` on `document.documentElement`
 * for Android and mobile web — so the Blink numbers are the live consumer of this
 * measurement, and the WebKit ones are the record of what was fixed.
 *
 * The measurements:
 *
 * - `root-custom-property` — a custom property on `document.documentElement`.
 * - `root-inherited-standard` — an ordinary *inherited* property (`color`) on the
 *   same element. Identical invalidation scope, so this is the pair that isolates
 *   "custom property"; root-vs-leaf alone only isolates "inheritance scope".
 * - `leaf-custom-property` — the same custom-property write aimed at a small
 *   subtree (the FAB, ~6 elements) instead of the root.
 * - `plain-property` — a non-inherited property (`padding-top`) on the root.
 * - `shell-height-write` — the `height` + `min-height` that `IosKeyboardService`
 *   drives onto `.app-container` while the keyboard animates.
 *
 * THE FINDINGS LIVE IN `docs/android-edge-to-edge-keyboard.md`, under "What a
 * `--keyboard-height` write on `<html>` costs". Numbers, the cross-engine
 * comparison and the decision not to port the iOS fix to Android are all there,
 * because that is the file someone reads before making an Android keyboard
 * change — nobody greps `e2e/measure/`. What stays here is how to run the thing
 * and how to read what it prints.
 *
 * HOW MUCH OF THIS IS NOISE. Clean WebKit runs gave these samples of the same
 * unmodified 201-row root write (opening and `[rows: none, repeat]`): 180.4,
 * 193.4, 194.0, 166.9, 174.3 — a spread of ~16%, which is why the published
 * WebKit figures are rounded. Treat anything under ~1.2x there as unresolved. Blink held
 * 12.8 opening against 12.6 repeat, but that is one pair, so its variant cells
 * are single samples too. Measure with nothing else running: one contaminated
 * run here inflated cells by a third to double, and stacking two runs is easy to
 * do by accident.
 *
 * KNOWN BLIND SPOTS. These are hand-simulated writes, not the real event
 * sequence: `IosKeyboardService` is gated on native iOS and never runs here.
 * Headless WebKit does no real tile rasterization and has no soft keyboard, so
 * the cost of Capacitor `resize: 'native'` animating the WKWebView frame is out
 * of reach at any list size. `ng serve` is an unoptimized build. An A15 is not
 * this machine — read the ratios, not the milliseconds. `ios-keyboard.service.ts`
 * quotes ~390ms for this write from the original #9779 investigation; that was a
 * single write on a different machine, where this table divides a 20-write total.
 * Same phenomenon, don't try to reconcile the absolute values.
 *
 * TIMING. WebKit clamps `performance.now()` to 1ms, so no single operation is
 * timed directly: every figure is an N-iteration total divided by N. The rule
 * that follows is that the TOTAL must clear the clamp, and each per-write figure
 * then carries ±(clamp/N) — ±0.05ms at N=20. That band is nothing against the
 * root write's 180ms and is the whole value of every 0.0-0.1ms cell, so treat
 * those as "below resolution", not as measured differences.
 *
 * COALESCING — a scratch measurement, not reproduced by this file. Every write
 * kind here forces a layout read after every write, which isolates one write's
 * cost but defeats the coalescing a real caller gets for free. Measured
 * separately in WebKit at 201 rows, relative to one write with a forced read:
 * four writes each followed by a forced read cost ~4x; four writes with a single
 * forced read at the end cost ~1x. Consecutive writes with no layout read
 * between them are about ONE recalc, not N. Ratios only — the cases ran once
 * each in fixed order, and the batched case wrote dummy properties nothing
 * consumes, so vars feeding a `calc()` may cost more. Before citing this table
 * against code that writes several properties in a row — the four
 * `--safe-area-inset-*` writes in `_initSafeAreaInsets`, say — check whether it
 * reads layout in between. Usually it does not.
 */
import { expect, test } from '../fixtures/test.fixture';
import type { Page } from '@playwright/test';
// Imported rather than hardcoded so a rename in the app breaks a grep here.
// Nothing typechecks `e2e/`, so this is a discoverability guard, not a build
// one — but the two symbols this header used to name went stale silently, and
// this is the cheapest thing that would have made that visible.
import { CSS_VAR_KEYBOARD_HEIGHT } from '../../src/app/core/theme/keyboard-css-vars.const';

/**
 * `??` does not catch an empty string and `Number('x')` is NaN; both used to
 * seed zero tasks and then fail 30s later inside `toHaveCount(NaN)`.
 */
const readCount = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
};

/** The reporter's Inbox: 128 open + 73 done. */
const OPEN_TASK_COUNT = readCount('MEASURE_OPEN_TASK_COUNT', 128);
const DONE_TASK_COUNT = readCount('MEASURE_DONE_TASK_COUNT', 73);
const TASK_COUNT = OPEN_TASK_COUNT + DONE_TASK_COUNT;
/** Mirrors the op-log batch cap; only affects how the seed is chunked. */
const MAX_BATCH_OPERATIONS_SIZE = 50;
const SHELL_WRITE_FRAMES = 30;
const ROOT_WRITES = 20;
const WRITE_KINDS = [
  'root-custom-property',
  'leaf-custom-property',
  'root-inherited-standard',
  'plain-property',
] as const;
const INBOX_PROJECT_ID = 'INBOX_PROJECT';

/**
 * Row-level CSS whose effect on each measurement is worth knowing.
 *
 * `verify` is not optional decoration. `task { display: none }` (specificity
 * 0,0,1) silently lost to the `:host { display: block }` in `_task-base.scss`,
 * which Angular's emulated encapsulation compiles to `[_nghost-*]` (0,1,0) — so
 * for one whole generation of this harness the `display:none` rows were plain
 * baselines printed under a different label, and nothing could tell. Every
 * variant now states the computed value it must produce, and `applyRowVariant`
 * throws if the cascade did not go its way.
 */
const ROW_VARIANTS: readonly {
  label: string;
  css: string;
  verify?: { property: string; expected: string };
}[] = [
  { label: 'none', css: '' },
  {
    label: 'content-visibility',
    css: 'task { content-visibility: auto; contain-intrinsic-size: auto 52px; }',
    verify: { property: 'content-visibility', expected: 'auto' },
  },
  // `!important` beats the host rule's higher specificity. Rows leave layout but
  // stay in the DOM, so this is the closest thing here to a style-vs-layout split.
  {
    label: 'display:none',
    css: 'task { display: none !important; }',
    verify: { property: 'display', expected: 'none' },
  },
];

const STYLE_ID = 'measure-variant-style';

const applyRowVariant = async (
  page: Page,
  css: string,
  verify?: { property: string; expected: string },
): Promise<void> => {
  await page.evaluate(
    ({ id, variantCss, check }) => {
      document.getElementById(id)?.remove();
      if (variantCss) {
        const style = document.createElement('style');
        style.id = id;
        style.textContent = variantCss;
        document.head.appendChild(style);
      }
      // Settle the new styles so they are not charged to the next measurement.
      document.body.getBoundingClientRect();
      if (!check) {
        return;
      }
      const row = document.querySelector('task');
      if (!row) {
        throw new Error('no task row to verify the variant against');
      }
      const actual = getComputedStyle(row).getPropertyValue(check.property).trim();
      if (actual !== check.expected) {
        throw new Error(
          `row variant did not apply: ${check.property} is "${actual}", ` +
            `expected "${check.expected}" — the cascade lost, so this run would ` +
            `have printed a baseline under the wrong label`,
        );
      }
    },
    { id: STYLE_ID, variantCss: css, check: verify ?? null },
  );
};

const clearRowVariant = (page: Page): Promise<void> => applyRowVariant(page, '');

const seedProjectTasks = async (
  page: Page,
  taskIdPrefix: string,
  openCount: number,
  doneCount: number,
): Promise<void> => {
  await page.evaluate(
    ({ batchSize, doneTaskCount, idPrefix, openTaskCount, projectId }) => {
      const count = openTaskCount + doneTaskCount;
      const store = (
        window as unknown as {
          __e2eTestHelpers?: { store?: { dispatch: (action: unknown) => void } };
        }
      ).__e2eTestHelpers?.store;
      if (!store) {
        throw new Error('__e2eTestHelpers.store missing — is this a dev/stage build?');
      }
      const operations = Array.from({ length: count }, (_, index) => ({
        type: 'create',
        tempId: `temp-${index}`,
        // Done rows land in the collapsible Completed Tasks section, which is
        // what the reporter collapses to make the lag go away.
        data: { title: `Measure seed ${index + 1}`, isDone: index >= openTaskCount },
      }));
      const createdTaskIds = Object.fromEntries(
        operations.map(({ tempId }, index) => [
          tempId,
          `${idPrefix}${String(index).padStart(4, '0')}`,
        ]),
      );
      for (let offset = 0; offset < operations.length; offset += batchSize) {
        store.dispatch({
          type: '[Task Shared] batchUpdateForProject',
          projectId,
          operations: operations.slice(offset, offset + batchSize),
          createdTaskIds,
          createdTaskTimestamp: 1_750_000_000_000,
          meta: {
            isPersistent: true,
            entityType: 'PROJECT',
            entityId: projectId,
            opType: 'BATCH',
          },
        });
      }
    },
    {
      batchSize: MAX_BATCH_OPERATIONS_SIZE,
      doneTaskCount: doneCount,
      idPrefix: taskIdPrefix,
      openTaskCount: openCount,
      projectId: INBOX_PROJECT_ID,
    },
  );
};

interface Sample {
  readonly label: string;
  readonly rowCount: number;
  readonly values: number[];
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const summarize = ({ label, rowCount, values }: Sample, unit: string): string => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    `${label.padEnd(38)} rows=${String(rowCount).padStart(4)} ` +
    `median=${median(values).toFixed(1)}${unit} ` +
    `min=${sorted[0].toFixed(1)}${unit} max=${sorted[sorted.length - 1].toFixed(1)}${unit}`
  );
};

/**
 * Shell-height write plus the forced layout the browser would do before paint,
 * totalled over `frames` because of the 1ms clock clamp.
 */
const measureShellHeightWrites = async (page: Page, frames: number): Promise<Sample> =>
  page.evaluate((frameCount) => {
    const shell = document.querySelector('.app-container') as HTMLElement | null;
    if (!shell) {
      throw new Error('.app-container missing');
    }
    const base = window.innerHeight;
    // Mimic the shrink animation: a different height every frame, which is what
    // iosShellHeight writes as visualViewport resize events land.
    const writeFrame = (i: number): void => {
      const height = base - 300 - (i % 7);
      shell.style.height = `${height}px`;
      shell.style.minHeight = `${height}px`;
      shell.getBoundingClientRect();
    };
    // A flat reading is only meaningful if the write moved something; without
    // this probe an inert write and a cheap one print the same number.
    const lastRow = document.querySelectorAll('task');
    const rowTopBefore = lastRow[lastRow.length - 1]?.getBoundingClientRect().top;
    const shellHeightBefore = shell.getBoundingClientRect().height;
    writeFrame(0);
    const hasEffect =
      shell.getBoundingClientRect().height !== shellHeightBefore ||
      lastRow[lastRow.length - 1]?.getBoundingClientRect().top !== rowTopBefore;

    const runs: number[] = [];
    for (let run = 0; run < 5; run++) {
      for (let i = 0; i < 5; i++) {
        writeFrame(i);
      }
      const started = performance.now();
      for (let i = 0; i < frameCount; i++) {
        writeFrame(i);
      }
      runs.push(performance.now() - started);
    }
    shell.style.height = '';
    shell.style.minHeight = '';
    shell.getBoundingClientRect();
    return {
      label: `shell-height-write x${frameCount} (has effect: ${hasEffect})`,
      rowCount: document.querySelectorAll('task').length,
      values: runs,
    };
  }, frames);

/**
 * The root custom-property write — still live on the non-iOS path
 * (`GlobalThemeService._initVisualViewportKeyboardTracking`) — against three
 * controls that each hold one variable steady:
 *
 * - `root-inherited-standard` keeps the element and the inheritance scope and
 *   changes only the kind of property. This is the load-bearing control: without
 *   it the root-vs-leaf gap reads as "inherited properties are expensive", which
 *   the numbers say is false.
 * - `leaf-custom-property` keeps the property kind and shrinks the scope.
 * - `plain-property` keeps the element and drops inheritance.
 *
 * Every timed write is followed by a forced layout read, which is what makes the
 * per-write division legitimate — the N iterations are homogeneous. `movesRows`
 * is probed separately and folded into the label, so a 0ms reading is never
 * mistaken for "layout is free". Note it reads `false` vacuously when there are
 * no rows, and under `display: none` where every rect is zero.
 */
type WriteKind = (typeof WRITE_KINDS)[number];

const measureCssVarWrites = async (
  page: Page,
  kind: WriteKind,
  writes: number,
): Promise<Sample> =>
  page.evaluate(
    ({ keyboardHeightVar, propertyKind, writeCount }) => {
      const root = document.documentElement;
      const leaf = document.querySelector('.add-task-button') as HTMLElement | null;
      if (propertyKind === 'leaf-custom-property' && !leaf) {
        throw new Error('.add-task-button missing — no leaf to write to');
      }
      const lastRow = (): Element | null => {
        const rows = document.querySelectorAll('task');
        return rows[rows.length - 1] ?? null;
      };
      const write = (i: number): void => {
        if (propertyKind === 'root-custom-property') {
          root.style.setProperty(keyboardHeightVar, `${300 + (i % 7)}px`);
        } else if (propertyKind === 'leaf-custom-property') {
          leaf!.style.setProperty(keyboardHeightVar, `${300 + (i % 7)}px`);
        } else if (propertyKind === 'root-inherited-standard') {
          // Same inheritance scope as the root custom property, different
          // property kind. This is the pair that isolates "custom property",
          // where root-vs-leaf only isolates "inheritance scope".
          root.style.setProperty('color', `rgb(${i % 7}, 0, 0)`);
        } else {
          root.style.setProperty('padding-top', `${i % 7}px`);
        }
        // Force the style recalculation the browser would do before paint.
        document.body.getBoundingClientRect();
      };
      // A reading of ~0ms only means "cheap"; whether it also relayouts the rows
      // is a separate question, and reporting it stops the two being conflated.
      write(0);
      const before = lastRow()?.getBoundingClientRect().top;
      write(5);
      const movesRows = before !== lastRow()?.getBoundingClientRect().top;

      const runs: number[] = [];
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        for (let i = 0; i < writeCount; i++) {
          write(i);
        }
        runs.push((performance.now() - started) / writeCount);
      }
      root.style.removeProperty(keyboardHeightVar);
      root.style.removeProperty('color');
      root.style.removeProperty('padding-top');
      leaf?.style.removeProperty(keyboardHeightVar);
      document.body.getBoundingClientRect();
      return {
        label: `${propertyKind} write (moves rows: ${movesRows})`,
        rowCount: document.querySelectorAll('task').length,
        values: runs,
      };
    },
    {
      keyboardHeightVar: CSS_VAR_KEYBOARD_HEIGHT,
      propertyKind: kind,
      writeCount: writes,
    },
  );

test.describe('#9779 root custom-property write cost', () => {
  test('what scales with the number of rendered task rows', async ({
    page,
    workViewPage,
    testPrefix,
    browserName,
  }) => {
    // Streamed, not buffered to the end: the run is minutes long, and a timeout
    // or a mid-run throw used to discard every number already measured.
    const record = (line: string): void => {
      // eslint-disable-next-line no-console
      console.log(`[measure] ${line}`);
    };
    // browserName + browser.version(), never a user-agent sniff: the shared
    // fixture overwrites the UA with "PLAYWRIGHT", which already made one
    // generation of this harness report webkit under both projects. The build is
    // printed rather than hand-written into the header above — a version nobody
    // re-checked is the kind of claim this file exists to stop making.
    record(
      `engine=${browserName} build=${page.context().browser()?.version() ?? 'unknown'} ` +
        (await page.evaluate(
          () => `viewport=${window.innerWidth}x${window.innerHeight}`,
        )),
    );

    // Seed straight into the built-in Inbox project: creating one through the UI
    // needs the side nav, which is collapsed at this viewport.
    await page.evaluate((projectId) => {
      window.location.hash = `#/project/${projectId}/tasks`;
    }, INBOX_PROJECT_ID);
    await workViewPage.waitForTaskList();

    // Boot work (lazy chunks, first render, initial sync) keeps running for a
    // while after the list appears, and it lands squarely on whatever is measured
    // first.
    // `waitForTimeout` is banned in e2e/tests for good reason; here there is no
    // event to wait for — the point is to let unrelated boot work drain.
    await page.waitForTimeout(2000);
    await measureShellHeightWrites(page, SHELL_WRITE_FRAMES);

    record('--- empty list ---');
    for (const kind of WRITE_KINDS) {
      record(summarize(await measureCssVarWrites(page, kind, ROOT_WRITES), 'ms'));
    }
    record(summarize(await measureShellHeightWrites(page, SHELL_WRITE_FRAMES), 'ms'));

    const taskIdPrefix = `${testPrefix}-measure-`;
    await seedProjectTasks(page, taskIdPrefix, OPEN_TASK_COUNT, DONE_TASK_COUNT);
    // A silent seeding failure would look exactly like "cost does not scale",
    // so the row count is asserted rather than merely reported.
    await expect(page.locator(`task[data-task-id^="${taskIdPrefix}"]`)).toHaveCount(
      TASK_COUNT,
      { timeout: 30000 },
    );
    await page.waitForTimeout(1500);

    record(
      `--- ${TASK_COUNT} tasks (${OPEN_TASK_COUNT} open + ${DONE_TASK_COUNT} done) ---`,
    );
    for (const { label, css, verify } of ROW_VARIANTS) {
      await applyRowVariant(page, css, verify);
      for (const kind of WRITE_KINDS) {
        record(
          summarize(await measureCssVarWrites(page, kind, ROOT_WRITES), 'ms') +
            `  [rows: ${label}]`,
        );
      }
      record(
        summarize(await measureShellHeightWrites(page, SHELL_WRITE_FRAMES), 'ms') +
          `  [rows: ${label}]`,
      );
      await clearRowVariant(page);
    }
    // Variants run in fixed order, and these numbers drift upward over a run.
    // Repeating the unmodified baseline last is what tells a real variant effect
    // apart from that drift — compare each variant to BOTH baselines.
    record(
      summarize(
        await measureCssVarWrites(page, 'root-custom-property', ROOT_WRITES),
        'ms',
      ) + '  [rows: none, repeat]',
    );

    // The reporter's own workaround, run as an A/B. Collapsing is not hiding:
    // `collapsible.component.html` wraps its panel in a structural `@if`, so the
    // done rows leave the DOM entirely rather than becoming `display: none`.
    const doneHeader = page
      .locator('collapsible', { hasText: 'Completed Tasks' })
      .locator('.collapsible-header')
      .first();
    await doneHeader.click();
    await expect(page.locator('task')).toHaveCount(OPEN_TASK_COUNT);
    record(`--- ${OPEN_TASK_COUNT} tasks, Completed Tasks collapsed ---`);
    record(
      summarize(
        await measureCssVarWrites(page, 'root-custom-property', ROOT_WRITES),
        'ms',
      ),
    );
  });
});
