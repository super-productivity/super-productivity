# Sync Time Tracking with Focus Mode — Concept Redesign

## Context

GitHub Discussion [#6781](https://github.com/super-productivity/super-productivity/discussions/6781) polled Pomodoro+time-tracking users on whether they sync the two; the result is ~100% yes. The current default `focusMode.isSyncSessionWithTracking: false` is therefore wrong for the population that uses both. Worse, the unsynced mode has user-visible defects (issue [#6731](https://github.com/super-productivity/super-productivity/issues/6731): pausing focus does NOT pause tracking — users call this a bug, not a config trade-off). Issue [#5737](https://github.com/super-productivity/super-productivity/issues/5737) records a long-time user lost the *old* simple workflow where pressing the tracking play button silently started a Pomodoro alongside it. Issue [#7112](https://github.com/super-productivity/super-productivity/issues/7112) proposes the replacement settings.

Time tracking and focus mode are independent features by default — pressing the play button just tracks time; focus mode is opt-in via F-key or the header focus button. Coupling them is a power-user choice. The redesign keeps that boundary intact while making the coupling, when active, cleaner and more predictable.

## Goal

1. **When both features are in use, lifecycles are always synced.** Pause↔pause, stop↔stop, resume↔resume. No user-facing toggle for this.
2. **Provide a single new opt-in for play-button auto-spawn.** Users who want #5737's old workflow flip one toggle. Default off.
3. **Entry point determines surface.** Manual entry (F-key, focus button, context-menu "Focus Session") → overlay. Auto-spawn from the tracking play button → a lean dedicated session indicator (see "Surface for the quiet/auto-spawned session" below). No new setting needed for this — the existing `isOverlayShown` reducer field already supports running a session with the overlay closed.
4. **Tidy the settings UI.** Move incidental flags into a collapsible "Advanced" section. `isPauseTrackingDuringBreak` is advanced; "pause means pause" is the default.

## Decision summary

| Today | After |
|---|---|
| `isSyncSessionWithTracking: false` (default) gates 8 effects; "off" mode buggy | Flag removed. Sync is always on. The 8 effects lose the gate. |
| Play button → tracks time; if sync on, also opens overlay | Play button → tracks time. If new opt-in `autoStartFocusOnPlay: true`, also spawns a focus session shown via a quiet header indicator (never overlay). |
| `isPauseTrackingDuringBreak` (default true) sits next to other flags in flat form | Default unchanged. Flag moved into a collapsed "Advanced" section. |
| `isStartInBackground` and `isSkipPreparation` apply to all entry points | Apply only to **manual** entry (F / focus button / context menu). Auto-spawn ignores them: indicator-only, no rocket. Both moved to "Advanced". |
| `isManualBreakStart` declared in form, missing from defaults | Add `false` default. Move to "Advanced". |

## Behavior changes — concrete

### Always-sync (when both are running)
The 8 effects in `src/app/features/focus-mode/store/focus-mode.effects.ts` (`autoShowOverlay$`, `syncTrackingStartToSession$`, `syncTrackingStopToSession$`, `syncSessionPauseToTracking$`, `syncSessionResumeToTracking$`, `syncSessionStartToTracking$`, `stopTrackingOnSessionEnd$`, `stopTrackingOnExitBreakToPlanning$`) lose the `cfg?.isSyncSessionWithTracking` filter. Their other gates (`isFocusModeEnabled`, screen state, etc.) remain. This fixes [#6731](https://github.com/super-productivity/super-productivity/issues/6731) by construction.

### Auto-spawn on play
- New flag: `focusMode.autoStartFocusOnPlay: boolean`, default `false`.
- New effect, sibling to the existing sync effects: when `currentTaskId$` transitions `null → id` AND `autoStartFocusOnPlay` AND `isFocusModeEnabled` AND no session is currently running → dispatch `startFocusSession({ duration })`. **Do not** dispatch `showFocusOverlay()`.
- F-key during a quiet/auto-spawned session → existing `showFocusOverlay()` dispatch promotes to overlay (free).
- Closing the overlay during a session → returns to the quiet indicator (free; existing behavior — session keeps running, overlay just hides).

### Surface for the quiet/auto-spawned session

The existing `updateBanner$` effect (lines ~829-978) reuses the global `BannerService` (`BannerId.FocusMode`). That's the wrong surface for an ongoing session:

- The focus-mode banner sits in the same slot as transient banners (`TakeABreak`, `Offline`, `CalendarEvent`, etc.) — see `src/app/core/banner/banner.model.ts:3-31`.
- `BannerId.FocusMode` is priority `1`, lowest in the system. Higher-priority banners (`TakeABreak: 6`, `CalendarEvent: 5`, …) hide it entirely — meaning during a session the user can lose the focus controls + countdown when other banners arrive.
- The banner is visually heavy; an always-on session indicator should be lean.

**Proposal: replace the banner usage with a dedicated lightweight session indicator.**

The existing header buttons are already the right anchors. Decorate one of them when a session is active so it doubles as the indicator — no new component, no banner pressure on layout. Two anchor candidates:

- **Anchor A — `PlayButtonComponent`** (`src/app/core-ui/main-header/play-button/play-button.component.ts`). Already next to the current task and already shows a progress ring; adding a compact countdown is the smallest visual delta. Fits "what's running on the current task" semantics.
- **Anchor B — `FocusButtonComponent`** (`src/app/core-ui/main-header/focus-button/focus-button.component.ts`). The existing manual entry point; lighting it up with the running countdown keeps responsibility cleanly split: play = tracking, focus = focus session.

**Interaction pattern (applies to either anchor)**: when a session is active, the button itself shows the countdown inline. **Hovering reveals a small row of controls below it** (pause/resume, skip break, end session, and a click-to-open-overlay affordance). **On touch / mobile** the controls are always visible (no hover state). Click the button itself → `showFocusOverlay()` to promote to the rich UI. Closing the overlay returns to this compact indicator state.

This pattern keeps the resting state lean (one button, slightly augmented), surfaces the controls only when needed on desktop, and doesn't degrade on mobile. It also avoids the banner system entirely — no priority conflict with `TakeABreak`/`Offline`/etc., and no layout displacement when a session starts.

Banner usage (`BannerId.FocusMode`, the `updateBanner$` effect) is removed entirely. A future iteration could add a closed-overlay "open me" hint as a transient banner, but only on session-start, not for the duration.

**Open for community input**: which anchor (play button vs focus button). The interaction (inline countdown + hover-popover controls + always-shown on mobile) is the same either way.

### `autoShowOverlay$` redesign
Today this effect fires whenever `currentTaskId$` changes and the gates pass — meaning play-button presses indirectly trigger the overlay. After: **delete the effect entirely**. The overlay opens only via explicit `showFocusOverlay()` dispatches (F-key handler, header focus button, task context menu). This is the cleanest way to enforce "entry point determines surface."

### Migration
- Existing config with `isSyncSessionWithTracking: true` → migrate to `autoStartFocusOnPlay: true`. Their behavior is largely preserved (auto-spawn still happens), but they now see a quiet header indicator instead of the overlay on auto-spawn. Pressing F still gets them the overlay. Acceptable trade.
- Existing config with `isSyncSessionWithTracking: false` (default-untouched) → migrate to `autoStartFocusOnPlay: false`. No auto-spawn. The only behavior change they perceive is that pause-focus now stops tracking (fixing #6731) — which they already wanted, per the bug report.
- Strip `isSyncSessionWithTracking` from the type so it cannot be re-introduced via stale stored configs.

## How a focus session is started today (for reference)

Useful to clarify the mental model:

- `appFeatures.isFocusModeEnabled` (default `true`) is a permanent feature switch. With it off, focus mode is unavailable entirely. **No "permanent Pomodoro on" setting exists** — there is no toggle that says "I am a Pomodoro user, always run a Pomodoro on my tracked task."
- A focus *session* is always **explicitly started** by the user via one of three entry points:
  1. The `F` keyboard shortcut → `showFocusOverlay()` (`src/app/core-ui/shortcut/shortcut.service.ts:130`).
  2. The header focus button → `showFocusOverlay()` (`src/app/core-ui/main-header/focus-button/focus-button.component.ts:106`).
  3. The task context menu "Focus Session" item → sets the current task and dispatches `showFocusOverlay()` (`task-context-menu-inner.component.ts:341`).
- After the overlay is shown, the user picks/confirms a task, the *mode* (Pomodoro/Flowtime/Countdown) is read from prior state, optional preparation screen runs, and the session begins.
- The selected **mode is persistent** across sessions: stored in `localStorage` under `LS.FOCUS_MODE_MODE`, default `Countdown` if absent (`focus-mode.reducer.ts:15-32`). It is the closest thing to a "Pomodoro switch" — but it lives in the focus-mode UI, not in settings, and only activates once the user explicitly starts a session.

The new `autoStartFocusOnPlay` toggle becomes the closest thing to a "Pomodoro/focus is always on while I track" switch — exactly what issue #5737 asked for. With it off (default) nothing changes; the three explicit entry points remain the only way to start a session. With it on, pressing the play button on a task is treated as a fourth, implicit entry point — and the session that spawns uses the persistent mode the user last chose.

## Files to touch

### Config / model
- `src/app/features/config/global-config.model.ts` — `FocusModeConfig` (around line 231): remove `isSyncSessionWithTracking?`; add `autoStartFocusOnPlay?: boolean`.
- `src/app/features/config/default-global-config.const.ts` (line 93-100): remove old flag, add `autoStartFocusOnPlay: false`, add missing `isManualBreakStart: false`.
- `src/app/features/config/form-cfgs/focus-mode-form.const.ts`: restructure into two-tier form. Primary: `autoStartFocusOnPlay`, `focusModeSound`. Advanced (collapsible — copy pattern from `src/app/features/config/form-cfgs/sync-form.const.ts:13-20`, `type: 'collapsible'` + `props: { syncRole: 'advanced' }`): `isPauseTrackingDuringBreak`, `isStartInBackground`, `isSkipPreparation`, `isManualBreakStart`.
- `src/assets/i18n/en.json`: add labels/help for `autoStartFocusOnPlay` (proposed copy: "Start a focus session when I start tracking a task" — peer-validated against Toggl Track's identical setting). Remove `L_SYNC_SESSION_WITH_TRACKING`. Per CLAUDE.md only edit en.json — other locales are not touched.
- `src/app/t.const.ts`: matching key changes.

### Effects
- `src/app/features/focus-mode/store/focus-mode.effects.ts`:
  - Delete `autoShowOverlay$` (lines 73-91) entirely.
  - Delete or repurpose `updateBanner$` (lines ~829-978) — banner-as-session-indicator is being replaced by the dedicated indicator (see surface options A/B above).
  - Remove `cfg?.isSyncSessionWithTracking` filter from 7 remaining effects: `syncTrackingStartToSession$`, `syncTrackingStopToSession$`, `syncSessionPauseToTracking$`, `syncSessionResumeToTracking$`, `syncSessionStartToTracking$`, `stopTrackingOnSessionEnd$`, `stopTrackingOnExitBreakToPlanning$`.
  - Add `autoStartFocusOnTracking$` effect: drives `currentTaskId$` → `null→id` transition; dispatches `startFocusSession` only when `autoStartFocusOnPlay && isFocusModeEnabled && timer.purpose === null` (no session active). Reuses `FocusModeStrategyFactory` to compute initial duration (same path as `syncTrackingStartToSession$:148-153`).

### Components
- `src/app/features/focus-mode/focus-mode-main/focus-mode-main.component.ts:190`: replace the `isSyncSessionWithTracking` read in `isPlayButtonDisabled` with the always-coupled equivalent.
- New / extended **session indicator** on whichever anchor we pick:
  - **Anchor A**: extend `src/app/core-ui/main-header/play-button/play-button.component.ts` to render an inline countdown when `selectIsSessionRunning` is true and the overlay is hidden, plus a hover-revealed controls row (pause/resume/skip/end/open-overlay).
  - **Anchor B**: same treatment on `src/app/core-ui/main-header/focus-button/focus-button.component.ts`.
  - Hover row uses CSS `:hover` on desktop; on touch / mobile the row is always visible (use `@media (hover: none)` or an existing platform check).
  - Either way, remove `BannerService` calls related to `BannerId.FocusMode` and the `updateBanner$` effect.

### Migration
- `src/app/op-log/validation/repair-global-config.ts` is currently fully commented out. Either revive it with focusMode-specific repair (strip stale `isSyncSessionWithTracking`; backfill `autoStartFocusOnPlay`) **or** rely on the existing deep-merge against `DEFAULT_GLOBAL_CONFIG` for backfill and add a one-liner that drops the old key. Prefer the second path for minimum surface area; only revive `repair-global-config.ts` if testing reveals defaults aren't merging.

### Tests
- Update spec files that reference `isSyncSessionWithTracking`:
  - `src/app/features/focus-mode/store/focus-mode.effects.spec.ts`
  - `src/app/features/focus-mode/store/focus-mode.bug-5875.spec.ts`
  - `src/app/features/focus-mode/store/focus-mode.bug-5995.spec.ts`
  - `src/app/features/focus-mode/store/focus-mode.bug-6064.spec.ts`
  - `src/app/features/focus-mode/store/focus-mode.bug-6575.spec.ts`
  - `src/app/features/focus-mode/focus-mode-main/focus-mode-main.component.spec.ts`
- New: `focus-mode.effects.spec.ts` cases for `autoStartFocusOnTracking$` (indicator-only spawn; no double-spawn when session already running; ignores when `autoStartFocusOnPlay: false`).
- New: regression test that pause-focus stops tracking unconditionally (covers #6731).

## Open for community discussion

- **Session indicator anchor**: anchor A (play button) or anchor B (focus button). The interaction pattern is fixed: inline countdown on the button, hover-revealed controls row below on desktop, always-visible on mobile. See "Surface for the quiet/auto-spawned session" above.
- **Naming of the new toggle**: `autoStartFocusOnPlay` (internal) and "Start a focus session when I start tracking a task" (label, mirrors Toggl Track's wording almost verbatim) is the current proposal — open to alternatives.

## Out of scope (explicit)

- Renaming `isPauseTrackingDuringBreak` → `isContinueTrackingDuringBreak`. Default stays `true` (= "pause means pause"); only the UI placement changes. Inversion is a clean follow-up if desired but not required for this change.
- The second proposed setting from #7112 ("Auto-select task when starting focus mode").
- First-run onboarding hint introducing `autoStartFocusOnPlay`.
- Mobile-specific defaults.
- Idle-detection interaction with the new always-sync behavior.

## Risk

- **Behavior change for users with `isSyncSessionWithTracking: false`**: pause-focus now stops tracking. This was the user-reported bug; intended. Acknowledge in commit message.
- **Behavior change for users with `isSyncSessionWithTracking: true`**: auto-spawn still happens, but produces a quiet header indicator instead of opening the overlay. Users who relied on the overlay popping up on play will need to press F (or click the indicator). Document in CHANGELOG.
- **Banner removal**: any users who relied on the `BannerId.FocusMode` banner (rare — it's only visible when overlay is closed and no higher-priority banner is active) lose it. The session indicator is the replacement.
- **Effects refactor touches 8 sites in one file**. Each gate is locally isolated; risk is medium and well-tested by existing bug-fix specs.
- **Form restructure**: `isManualBreakStart` currently lacks a default; adding one may unblock latent code paths. Verify in tests.

## Verification

- `npm run test:file src/app/features/focus-mode/store/focus-mode.effects.spec.ts` — all updated effects specs pass.
- `npm test` — full unit suite green.
- `npm run checkFile` on each modified `.ts` and `.scss`.
- Manual smoke (web `ng serve`):
  1. Fresh config: press play on a task → no indicator, no overlay, time accrues.
  2. Press F → overlay opens with rocket. Press pause → tracking stops. Press resume → tracking resumes.
  3. Stop session via overlay → tracking stops.
  4. Toggle `autoStartFocusOnPlay` on. Press play on a task → header indicator shows countdown, overlay does NOT. Press F → overlay opens (promotes). Close overlay → indicator returns, session continues.
  5. With `autoStartFocusOnPlay` on: pause focus → tracking stops; resume focus → tracking resumes; stop focus → tracking stops.
  6. With `autoStartFocusOnPlay` on and Pomodoro mode: at session end, break starts. Confirm `isPauseTrackingDuringBreak: true` (default) → tracking stops at break-start. Toggle to `false` (advanced) → tracking continues through break.
- E2E: extend `e2e/tests/focus-mode/` (if present) with one auto-spawn flow.
