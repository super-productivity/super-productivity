# Marketing reel pipeline

Playwright-driven generation of the marketing gif/video for the landing page and GitHub README. Mirrors the screenshot pipeline (`e2e/store-screenshots/`) — same fixture/seed plumbing, similar npm-script shape.

## Run

```bash
npm run video         # tight default (~17s) → dist/video/reel*.{mp4,webm,gif}
npm run video:full    # full variant (~21s) → dist/video/reel-full*.{...}

# under the hood
npm run video:capture # Playwright records to .tmp/video/recordings/
npm run video:build   # ffmpeg → dist/video/, picks the most recent webm
```

`REEL_VARIANT=<name>` switches the spec branch and adds a filename suffix so multiple variants coexist in `dist/video/`. `full` is the only one wired up so far; add more by branching on `isFull`-style flags in the spec.

`gifsicle` is optional — the build script falls back to ffmpeg's gif if it's missing. With it installed, you also get `reel-optimized.gif` (~30% smaller).

## Files

| File                                            | Responsibility                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.store-video.config.ts`              | Single chromium project, `video: 'off'` at project level (the fixture handles `recordVideo` itself because `browser.newContext()` doesn't inherit `use.video`).                                                 |
| `store-video/fixture.ts`                        | Custom context with `recordVideo` enabled at 1024×1024 / DPR 2. Reuses the screenshot pipeline's seed builder. Init scripts handle: cursor highlight ring, dialog/snack/tooltip/mention suppression, app zoom. |
| `store-video/overlays.ts`                       | DOM-injected overlay primitives: `showOverlay`, `showIntegrationsCard`, `showEndCard`, `cutToScene`, `fadeTransition`, `loopBoundary`, `attachDragGhost`. Plus inline brand SVGs in the `LOGOS` constant.       |
| `store-video/scenarios/reel.spec.ts`            | Six-beat choreography. `REEL_VARIANT=full` triggers the optional "No account. No tracking." beat and relaxes hold timings.                                                                                      |
| `store-video/build-video.ts`                    | Picks the most recent `.webm` under `.tmp/video/recordings/`, applies the trim sidecar (cuts the seed-import lead-in), produces mp4/webm/gif via ffmpeg, optionally `gifsicle`-optimizes.                       |

## Beat structure (current)

```
Lead-in   black fades to SP UI with schedule day-panel already open
1  Capture in seconds.        global add-task-bar (scaled 1.45×, max-width
                              520px); types "A task 1h #urgent @17" with
                              55ms keystroke delay. Captured task carries
                              through to beats 2 and 3.
1.5 [full only]               No account. No tracking.
2  Plan your day.             drags first task onto schedule panel with
                              `attachDragGhost` cloning the source element
                              under the cursor.
3  Focus on what matters.     dispatches `[Task] SetCurrentTask` /
                              `[FocusMode] Show Overlay` /
                              `[FocusMode] Start Session` directly via
                              `__e2eTestHelpers.store`. `clock.runFor(5500)`
                              skips the 5s countdown; `clock.resume()` lets
                              the timer tick during the hold.
4  Plays well with GitHub,    full-screen integrations card. Title in a
   Jira & more.               lower-third bar at `bottom: 72px`. Logos
                              centered above; brand colors on GitLab
                              (#fc6d26) and Jira (#2684ff). Subtitle "& many
                              more" below the grid.
5  Free and open source.      end card with monochrome SP logo, animated
                              stat counter-ups (★ 19K, 4.8 ★) staggered by
                              280ms, platforms line on one line.
Boundary  black fades in so the gif loop seam is black-to-black
```

## Scene transitions: cutToScene

Every beat handoff uses `cutToScene(page, async () => { ... })` for a fade-to-black scene cut. The helper:

1. Fades a max-z-index black overlay from transparent to opaque (covers everything, including any beat overlays/cards).
2. Runs the callback while the screen is fully black — this is where state changes happen (close add-task-bar, dispatch focus mode, hide previous overlay, prime next overlay/card).
3. Fades the black back out to reveal whatever the callback set up.

**Always pass `noWait: true` to the next overlay/card inside the callback.** Without it, the call awaits its own fade-in (and stagger animation, for `showIntegrationsCard`/`showEndCard`) — which would play behind the still-opaque black and be wasted. With `noWait`, the call returns as soon as the DOM is in place, so the fade-in animates concurrently with `cutToScene`'s fade-from-black. The viewer sees: scene → black → next-scene-emerging-with-its-animation.

`fadeTransition` (partial-dim, lower z-index) is no longer used by the main spec — it was unreliable for big scene jumps because the dim's transparent regions let the underlying state change show through. Kept in `overlays.ts` in case a future beat wants a softer mid-beat dim, but `cutToScene` is the default.

## Architecture decisions / gotchas

**Trim sidecar.** The recording necessarily includes ~14s of seed-import navigation before the choreography starts. The fixture stamps `recordingState.startMs` at context creation; the spec calls `markBeatsStart()` when ready; the delta lands in `.tmp/video/recordings/_latest-trim.json` and ffmpeg `-ss` skips past it. **Don't try to inject the seed via IndexedDB** — the addInitScript timing race vs. SP's IDB-read is genuinely unsafe and the trim sidecar handles host-speed variance correctly.

**Page clock.** `page.clock.install({ time: SCREENSHOT_BASE_DATE })` is on by default (inherited from screenshot fixture). This freezes `Date.now`, `setTimeout`, `setInterval`, and `requestAnimationFrame` in the page until you call `clock.runFor(ms)` or `clock.resume()`. Beat 3 calls `runFor(5500)` to skip the 5s focus-mode countdown, then `resume()` so the running timer ticks naturally and end-card stat counters animate (they use rAF).

**Material snack bars and dialogs.** Hidden via CSS in the fixture init script (`.cdk-overlay-pane:has(.mat-mdc-dialog-container)`, `.mat-mdc-snack-bar-container`, plus `mention-list`, `.mention-menu`, `.add-task-bar-panel`). With the clock installed, snack auto-dismiss timers don't fire on their own — hiding them is cleaner than waiting. focus-mode-overlay isn't a mat-dialog so it's unaffected.

**App zoom.** `app-root { zoom: 1.4 }` in fixture init "zooms in" on the SP UI without shrinking the recording canvas. At 1.4 the inner viewport for the layout is 1024/1.4 ≈ 731px — enough for the work-view + collapsed sidenav + 240-wide right panel without clipping. Earlier 1.5 was cropping the right edge of the work view. Earlier 1.4 iterations *also* stacked `transform: scale(1.45)` on the add-task-bar, but that compounded badly with the zoom and clipped past the viewport — letting `app-root zoom` do the work alone is simpler. Overlays are siblings of `app-root` in the DOM tree (appended to `body`), so they're unaffected by this zoom — design overlay sizes against the un-zoomed viewport.

**Schedule day-panel width.** Pre-seeded in `ONBOARDING_INIT` via `localStorage.setItem('SUP_RIGHT_PANEL_WIDTH', '250')` — that's `RIGHT_PANEL_CONFIG.MIN_WIDTH`, the smallest the panel allows before its 200px CLOSE_THRESHOLD kicks in. Pre-seeding through the panel's own persistence path means the inner schedule grid computes its column widths against 250 and the event blocks don't overflow. Earlier iterations forced `width !important` on `.side`, which sized the chrome but didn't propagate to the grid — events then spilled past the panel's right edge and required ugly `overflow-x: hidden` belt-and-braces clips. Don't go that route.

**Add-task-bar overlays.** The fixture only hides the *overlay surfaces* that pop on top of the bar while typing (mat-autocomplete suggestions, mention-list, loading spinner) — those would otherwise read as glitchy white boxes mid-gif. The bar itself is not styled by the fixture; it uses its real `:host` rules.

**Cursor highlight.** Soft white radial-gradient ring at `z-index: 2147483640`, follows mousemove. Toggle visibility per-beat via `body.__sp-hide-cursor-highlight` — used during the capture beat where the focused input would otherwise show the ring as a stray dot.

**Main-text consistency.** `.__sp-video-overlay-text`, `.__sp-video-int-card-title`, `.__sp-video-end-card-title` share a single rule with `font-size: clamp(48px, 6.4vw, 96px) !important`. The `!important` flag is required because `.mat-typography h1` has specificity (0,1,1) which outranks our class-only selector. Card titles are `<p>` rather than `<h1>` for belt-and-braces — even with `!important`, the typography font shorthand can sneak through.

**Drag ghost.** Beat 2 uses `attachDragGhost(page, sourceLocator)` which clones the source via `outerHTML`, attaches a mousemove listener, and follows the cursor with a 2° tilt + drop shadow. Detaches on mouse-up. SP's cdkDrag may or may not show its own preview depending on the drop target's `cdkDropList` wiring; the ghost guarantees the act of dragging reads regardless.

**Loop boundary.** `loopBoundary(page, 'in', ms)` shows full-black opacity 1 then fades to 0 over `ms` (lead-in). `loopBoundary(page, 'out', ms)` fades from 0 to 1 (closing). Gif seam is black-to-black, no jump cut. `z-index: 2147483647` (max safe) so it covers everything including end card.

**Build script picks most-recent webm.** No need to clean `.tmp/video/recordings/` between runs. Old webms accumulate but only the most recent `.mtime` is built into outputs.

**Variant filename suffix.** `build-video.ts` reads `process.env.REEL_VARIANT` and appends `-${variant}` to all output filenames when set. `npm run video:full` works because env vars propagate through `npm run`.

## Iteration loop

1. Edit `reel.spec.ts` (copy, beat order, durations) or `overlays.ts` (visual styling).
2. `npm run checkFile <path>` on every changed `.ts` file (per project CLAUDE.md).
3. `npm run video` — capture (~32s) + build (~10s).
4. Open `dist/video/reel-optimized.gif`.

**Don't** put backticks inside CSS comments in template literals — they're parsed as nested template expressions and break TypeScript. Multiple iterations have stumbled on this.

**Don't** use mixed `+`/`*` operators without parentheses in spec coordinates — eslint `no-mixed-operators` will fail. Use intermediate `const` or wrap in parens.

## Open polish ideas (not yet shipped)

- **Theme + locale matrix.** Fixture supports both via `test.use({ theme, locale })`. Add Playwright projects per variant; matrix run produces `reel-en-dark.gif`, `reel-en-light.gif`, etc. Mirrors the screenshot pipeline pattern.
- **Aspect ratio variants.** 16:9 (1920×1080) for landing-page hero, 9:16 (1080×1920) for mobile social. Different `VIDEO_SIZE` per matrix entry.
- **5-second social cut.** `npm run video:short` produces beats {1, 3, 5}. Trivial extension of the variant flag.
- **Drop-slot highlight.** Brief CSS pulse on the schedule slot the dragged task lands in — gives beat 2 a closing punctuation.
- **Brand-color flash on logo entrance.** Currently logos are flat brand colors. Could flash bright then settle.
- **End-card "Open the app →" CTA.** Chip-styled visual cue; not a real link.
- **Tighten further.** Current default lands at ~17s; could push to ~14s by tightening drag pause times.

## Coordinates with project-wide CLAUDE.md

Lives under `e2e/`, so `e2e/CLAUDE.md` rules also apply (test template, fixture conventions). Linting via `npm run checkFile` per the root project guidance. No translations affected — all overlay copy is hard-coded English in the spec for now.
