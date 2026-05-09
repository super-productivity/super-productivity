# Automated screenshot pipeline

Reproducible app-store screenshots driven by Playwright + a single seed dataset.

## Quick start

```bash
# Capture everything (all viewports × all scenarios that apply to that platform)
npm run screenshots

# Or split:
npm run screenshots:capture          # full web matrix → dist/screenshots/_master/
npm run screenshots:capture:desktop  # desktopMaster only
npm run screenshots:capture:mobile   # iPhone/iPad/Android viewports only
npm run screenshots:capture:electron # Electron build → dist/screenshots/_master_electron/
npm run screenshots:electron         # capture:electron + build (lands in dist/)
npm run screenshots:build            # rebuild dist/ layout from existing masters

# One group while iterating
npx playwright test --config e2e/playwright.store-screenshots.config.ts \
  --project=desktopMaster --grep "desktop all"
```

## Environment overrides

| Var                                                        | Effect                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `SCREENSHOT_MODE=electron`                                 | Switches the fixture to the Electron pipeline (set by `screenshots:capture:electron`).                                                    |
| `SCREENSHOT_BASE_DATE=2026-05-06T09:30:00`                 | Pin the "today" anchor used by the seed builder. Default is a Wednesday well clear of midnight in CI timezones.                           |
| `SP_SCREENSHOT_BG_DARK_URL` / `SP_SCREENSHOT_BG_LIGHT_URL` | Override the default Unsplash backgrounds (e.g. point to a vendored asset for offline / privacy-sensitive runs).                          |
| `SP_SCREENSHOT_BG_DISABLE=1`                               | Drop background images entirely.                                                                                                          |
| `SP_SCREENSHOT_BG_OVERLAY_OPACITY=80`                      | Drives the per-context "Darken/lighten background image for better contrast" slider (0–99). Default 80 for screenshots vs. 20 in the app. |

Master captures land in `dist/screenshots/_master/<viewport>/<locale>/<theme>/<scenario>/<name>.png`.
Per-store assets land in `dist/screenshots/<store>/<locale>/NN-name.png` (and the F-Droid `fastlane/...` layout).

## Scenario lineup

| Slot       | Platform | Theme | What it shows                                                     |
| ---------- | -------- | ----- | ----------------------------------------------------------------- |
| mobile-00  | mobile   | dark  | Cover/hero — Today list with marketing caption overlay            |
| desktop-00 | desktop  | dark  | Cover/hero — Today list with marketing caption overlay            |
| tablet-00  | tablet   | dark  | Cover/hero — Today list with marketing caption overlay            |
| mobile-01  | mobile   | dark  | Planner                                                           |
| mobile-02  | mobile   | dark  | Planner with calendar nav expanded                                |
| mobile-03  | mobile   | dark  | Eisenhower matrix board                                           |
| mobile-04  | mobile   | light | Planner expanded (light variant)                                  |
| mobile-05  | mobile   | dark  | Schedule view                                                     |
| mobile-06  | mobile   | dark  | Today task list                                                   |
| desktop-01 | desktop  | dark  | Today + schedule day-panel open                                   |
| desktop-02 | desktop  | dark  | Eisenhower matrix board                                           |
| desktop-03 | desktop  | dark  | Schedule view                                                     |
| desktop-04 | desktop  | light | Project (Work) + notes panel populated                            |
| desktop-05 | desktop  | dark  | Focus mode                                                        |
| desktop-06 | desktop  | light | Schedule (light variant)                                          |
| desktop-07 | desktop  | dark  | Project (Work) view, no wallpaper — regular palette reads cleanly |
| desktop-08 | desktop  | dark  | Planner                                                           |

Specs are platform-grouped: `scenarios/desktop/all.spec.ts` and `scenarios/mobile/all.spec.ts` each capture every slot in a single session, flipping `DARK_MODE` between groups via `applyTheme()` (Playwright `addInitScript` is append-only, so a later script wins on each reload). Each spec runs once per locale (en + de).

## Files

| Path                                        | Purpose                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix.ts`                                 | Locales, themes, viewports, mobile/desktop classification, store rules                                                                                                                                      |
| `seed/seed.template.json`                   | Curated dataset with date offsets and `@@PLANNER_OFFSET_+N` placeholders                                                                                                                                    |
| `seed/build-seed.ts`                        | Materializes offsets to absolute dates, injects `locale` + `customTheme`                                                                                                                                    |
| `fixture.ts`                                | Pins clock, applies dark-mode, imports seed via UI flow, exposes `screenshotMaster` (which reads live `DARK_MODE` so light/dark scenes land in the right directory)                                         |
| `helpers.ts`                                | `gotoAndSettle`, `openNotesPanel`, `openSchedulePanel`, `resetView`, `applyTheme`, `applyLocale`, `applyTimeTrackingEnabled`, `applySideNavCollapsed`, `setPlannerCalendarExpanded`, `showMarketingOverlay` |
| `marketing-copy.ts`                         | Headline + subline shown on the slot-00 hero overlay                                                                                                                                                        |
| `scenarios/desktop/all.spec.ts`             | 9 desktop slots: hero + 8 scenes                                                                                                                                                                            |
| `scenarios/mobile/all.spec.ts`              | 7 mobile slots: hero + 6 scenes                                                                                                                                                                             |
| `scenarios/tablet/all.spec.ts`              | 6 tablet slots: hero + 5 scenes                                                                                                                                                                             |
| `build-store-assets.ts`                     | Renames + copies masters into per-store layouts; JPEG re-encode for `maxBytes`-capped stores (Snap); emits `_preview.html` contact sheet                                                                    |
| `../playwright.store-screenshots.config.ts` | Separate Playwright config; one project per viewport                                                                                                                                                        |

## How it works

1. **Per-test seed file** is materialized to `.tmp/screenshot-seeds/seed-<date>-<locale>[-<customTheme>].json`.
2. **Fixture** boots the app with `page.clock.install({ time: SCREENSHOT_BASE_DATE })`, sets `localStorage.DARK_MODE`, pins browser context to `en-US` (so `ImportPage`'s English text matchers always work), then imports the seed via `BackupService.importCompleteBackup`. Locale flows through `globalConfig.localization.lng` → `applyLanguageFromState$` effect. Custom themes flow through `globalConfig.misc.customTheme`.
3. **Each scenario spec** drives the app to a state and calls `screenshotMaster(scenario, name)`. The Playwright project name (e.g. `desktopMaster`) determines the viewport.
4. **Post-processor** copies masters into per-store layouts. No resizing — captures are already at native size for each store.

## Adding a scenario

```ts
// scenarios/desktop/08-new-thing.spec.ts
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle, onlyOn } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot desktop-08-new-thing (${locale})`, () => {
    test.use({ locale, theme: 'dark' });

    test('new thing', async ({ seededPage, screenshotMaster }, testInfo) => {
      onlyOn(testInfo, 'desktop');
      await gotoAndSettle(seededPage, '/#/whatever');
      await seededPage.locator('whatever-component').waitFor();
      await screenshotMaster('desktop-08-new-thing', 'new-thing');
    });
  });
}
```

## Per-store gotchas

- **MS Store** reserves bottom 1/4 for system-rendered captions → keep critical UI in top 3/4.
- **Mac App Store** rejects letterboxed 16:9 in 16:10 frames — capture native 2880×1800.
- **Snap** caps at 5 items, ≤2 MB each, single global gallery (no per-locale). Pipeline emits all desktops re-encoded as JPEG (mozjpeg, q90→q60 step-down) so each fits the cap; **trim manually to 5 before Snap upload**.
- **Play / Apple** explicitly forbid / discourage device frames.
- **Apple** requires only iPhone 6.9" (1290×2796) and iPad 13" (2064×2752); smaller sizes auto-derive.
- **Flathub** requires native window chrome and forbids overlays — sourced from the Electron capture pipeline (single global gallery; run on a Linux X11/Wayland host via `npm run screenshots:capture:electron`).

## Electron pipeline (Mac App Store, Flathub)

Web Chromium captures don't look "native" on macOS — wrong fonts, wrong scrollbars, no traffic-lights. Flathub explicitly _requires_ native window chrome. So there's a parallel pipeline that runs the actual SP Electron build via Playwright's `_electron` API. macOS captures use Electron renderer screenshots plus a deterministic hiddenInset traffic-light overlay; Linux captures use OS-level region tools (`grim`/`import`) so Flathub gets real GTK chrome.

```bash
# Capture only — masters land in dist/screenshots/_master_electron/.
npm run screenshots:capture:electron

# Capture + build — masters and deliverables under dist/screenshots/
# (macappstore/, flathub/). Mirrors `npm run screenshots` for the web pipeline.
npm run screenshots:electron
```

Same scenarios, same fixture file — `store-screenshots/fixture.ts` branches on the `SCREENSHOT_MODE` env var (the npm script sets it). Each desktop spec runs unchanged in either mode.

On macOS, Playwright-launched Electron is not always treated like a LaunchServices-started `.app`, and OS capture can miss AppKit's hiddenInset traffic lights even when the window content is correct. The fixture avoids that fragile path: it captures the renderer at the target 2560×1600 Retina size and composites the three traffic lights at AppKit's hiddenInset coordinates.

On Linux, the OS-level capture grabs the full window rect including titlebar, shadow, and GTK decoration. Bounds come from `BrowserWindow.getBounds()`; on X11/Wayland bounds == pixels.

Per-OS tooling (must be on PATH):

- **macOS** — no external capture tool; the fixture forces Retina-scale capture so the renderer screenshot lands at 2560×1600.
- **Linux X11** — ImageMagick (`apt install imagemagick`, ships `import`)
- **Linux Wayland** — `grim` (`apt install grim`, wlroots-based compositors only)

The Mac App Store store rule has `masterDir: 'electron'` in `STORE_RULES`, so the post-processor pulls those captures into `dist/screenshots/macappstore/`. All other stores still come from the web pipeline.

## Status

- ✅ Foundation: matrix, seed builder, fixture (web + electron modes), helpers, post-processor
- ✅ 22 scenarios (3 hero + 6 mobile + 8 desktop + 5 tablet) covering planner, boards, schedule, focus, notes, project view
- ✅ Per-build `_preview.html` contact sheet under `dist/screenshots/` for one-click QA
- ✅ Electron-mode pipeline with macOS traffic-light compositing and Linux OS chrome capture (`grim` / `import`)
- ✅ Mac App Store wired to source from `_master_electron/`
- ✅ Flathub STORE_RULE (single-gallery, sourced from `_master_electron/`)
- ✅ Snap JPEG re-encode under 2 MB cap (mozjpeg, automatic per-file)
- ✅ Tooltip suppression + cursor parking so leftover Material tooltips don't bleed into captures
- ⏳ Smoke-test the Electron pipeline on a real Mac (or Linux X11 for plumbing)
