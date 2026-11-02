import { afterNextRender, inject, Injector } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { Log } from '../log';

/**
 * Cold-start timing marks for the web side of boot.
 *
 * Each mark records `performance.now()`, i.e. ms since the document's
 * navigation start, so it covers HTML load and bundle evaluation but not the
 * native shell before the WebView (measure that with `adb shell am start -W`).
 * The marks are logged once, after the first route has rendered, so a log
 * export from a real (slow) device shows where startup time goes. They are
 * also mirrored as `performance.mark()` entries for DevTools traces.
 *
 * Marks after the report (e.g. a later `hydrateStore()` re-entry from
 * `reInit()`) are ignored: they would not be cold-start timings.
 */
const MARK_PREFIX = 'sp-boot:';

const _marks: { name: string; ms: number }[] = [];
let _isReported = false;

export const markBoot = (name: string): void => {
  if (_isReported) {
    return;
  }
  _marks.push({ name, ms: Math.round(performance.now()) });
  try {
    performance.mark(MARK_PREFIX + name);
  } catch {
    // performance.mark is optional diagnostics only
  }
};

export const logBootTimings = (): void => {
  if (_isReported) {
    return;
  }
  _isReported = true;
  Log.log(
    '[Boot] ms since navigation start: ' +
      _marks.map(({ name, ms }) => `${name}=${ms}`).join(' '),
  );
};

/**
 * Logs the boot timings once the first navigation (which waits for the initial
 * data load, see app.guard.ts) has rendered. Must run in an injection context
 * before the initial navigation starts, i.e. as an app initializer.
 */
export const reportBootTimingsOnFirstRender = (): void => {
  const injector = inject(Injector);
  inject(Router)
    .events.pipe(
      filter((ev) => ev instanceof NavigationEnd),
      take(1),
    )
    .subscribe(() => {
      markBoot('first-navigation');
      afterNextRender(
        () => {
          markBoot('first-render');
          logBootTimings();
        },
        { injector },
      );
    });
};

/** Test-only: resets the module state between specs. */
export const _resetBootTimingsForTest = (): void => {
  _marks.length = 0;
  _isReported = false;
};
