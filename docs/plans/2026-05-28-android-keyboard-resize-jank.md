# Smooth the Android soft-keyboard resize

**Status:** proposal (revised after multi-review; no implementation code yet)
**Date:** 2026-05-28
**Revision:** Multi-review (6 reviewers) confirmed all codebase claims and the
core thesis, but flagged the plan as over-staged and the root-cause "repaint"
leg as unverified. Folded in: a mandatory baseline trace as the go/no-go gate;
collapsed to a KISS core (static per-activity flip + scroll-into-view) with
VirtualKeyboard/`overlaysContent`/runtime-probe **deferred behind proven need**;
the CDK-overlay fix made explicit scope; a cheap `distinctUntilChanged()` win.
**Trigger:** On Android the screen resize when the soft keyboard opens/closes is
choppy/janky, and (before the fix below) the white page background briefly
flashed even in dark theme. The white flash is already fixed; this doc is about
the remaining *choppiness*.
**Already shipped (commit `80b08f0e96`):** white-flash fix — the native WebView
surface is now painted in the theme background (`values`/`values-night`
`windowBackground` color + a `NavigationBar.setWebViewBackgroundColor` push kept
in sync with the JS theme), plus a backdrop-compositing tweak (`body::before`
promoted to its own compositor layer). **Caveat (from review):** the compositing
tweak is likely a no-op for the jank — the backdrop box *resizes* every frame
under `adjustResize`, so its gradient re-rasterizes regardless of layer
promotion (`will-change: transform` only helps for transforms, not size
changes). It is harmless and reversible; do not count on it.

## TL;DR

The jank is **not** a CSS problem and **not** fixable from the web layer alone.
It is the native `windowSoftInputMode=adjustResize` resizing the whole WebView
window on every frame of the IME slide → the layout viewport shrinks each frame
→ the entire Angular tree relayouts and the full-viewport backdrop repaints per
frame.

Since Chrome 108 the *browser* resizes only the visual viewport for the keyboard
(precisely to avoid this jank), but that change **explicitly excludes Android
WebView** — the host app owns the behavior via `windowSoftInputMode`. So the
real lever is native: switch the Capacitor activity from `adjustResize` to
`adjustNothing` and drive all keyboard-aware layout from the visual-viewport /
keyboard-inset signal the app already tracks (`--keyboard-height`).

**Do the smallest thing first.** The KISS core is a static one-liner +
reuse of existing code: flip **only** `CapacitorMainActivity` to `adjustNothing`
(legacy F-Droid `FullscreenActivity` stays on `adjustResize`) and generalize the
existing iOS `_scrollActiveInputIntoView` to the Android visual-viewport path.
No runtime probe, no VirtualKeyboard API, no new geometry pipeline — the app
already derives `--keyboard-height` from `innerHeight - visualViewport.height`,
which is exactly what current WebViews provide. Reach for the VirtualKeyboard
API + a capability probe **only if** on-device testing finds a shipping WebView
that gives no height signal under `adjustNothing`. And gate the whole thing
behind a **baseline DevTools trace** that confirms layout reflow (not paint) is
the dominant cost — so we fix the thing that's actually slow.

## Root cause (confirmed, ~90%)

- Chrome 108+ resizes only the **visual viewport** on OSK, to avoid layout jank.
  ([Chrome blog](https://developer.chrome.com/blog/viewport-resize-behavior),
  [explainer](https://github.com/bramus/viewport-resize-behavior/blob/main/explainer.md))
- That default **does not apply to WebView**: "The Android app is responsible
  for sizing the WebView and can implement either mode via `windowSoftInputMode`."
  ([blink-dev intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/ge7xTu-VhJ0))
- With `adjustResize`, our WebView gets the old pre-108 path: the OS resizes the
  window and the **layout viewport** (ICB) shrinks every frame, viewport units
  recompute → per-frame relayout = the stutter.
- **Which cost dominates is unverified** (review caveat). The strongest leg is
  *layout reflow* of the shrinking ICB. The full-viewport `body::before` repaint
  is a weaker leg — see the compositing caveat above. A **baseline DevTools
  trace must attribute Layout vs Recalc-Style vs Paint vs Scripting before we
  commit to the fix**, so we don't optimize the wrong thing.
- A likely-underweighted **third leg** (review): `CapacitorMainActivity`'s
  `OnGlobalLayoutListener` fires on *every* layout pass during the slide and
  pushes into `isKeyboardShown$` — a bare `BehaviorSubject` with **no**
  `distinctUntilChanged` — whose subscriber rewrites `<body>` classes each
  frame, invalidating style across the tree and re-triggering Angular CD. This
  partially survives the `adjustNothing` flip (the listener still fires), so a
  `distinctUntilChanged()` is an independent cheap win (see core fix below).
- The debounced `--keyboard-height` is committed once on open, so it is **not**
  the per-frame driver. The add-task-bar `transition: bottom 225ms` can visibly
  race the native slide (secondary cosmetic mismatch), not the stutter source.
- Version split in our user base: a **recent WebView milestone (~Chrome 139,
  2025 — exact version unverified)** added automatic IME visual-viewport
  resizing (bottom-edge only), so on those builds the visual viewport shrinks the
  way our VisualViewport code already expects; older WebViews and the legacy
  F-Droid WebView do not.
  ([Android WebView insets doc](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets),
  [crbug 40287394](https://issues.chromium.org/issues/40287394))

**The load-bearing finding:** the `interactive-widget` viewport meta key and the
VirtualKeyboard API only suppress the *Blink* viewport resize — neither
overrides the native window resize in a WebView. The fix is primarily a native
`windowSoftInputMode` decision, optionally hardened by a web-platform mechanism.

## Approach comparison

| Approach | Mechanism | Stops per-frame reflow? | WebView support | Interaction w/ adjustResize + edge-to-edge | Effort | Risk | Reversibility |
|---|---|---|---|---|---|---|---|
| **A. `interactive-widget=overlays-content` meta** | Tells Blink not to resize viewport | Only the Blink resize — OS still resizes window under it | Blink feature (Chrome 108+); intent says not wired for WebView | Must ALSO change `windowSoftInputMode` or it's a no-op | Low | High (likely no-op alone) | Trivial |
| **B. VirtualKeyboard API (`overlaysContent=true` + `env(keyboard-inset-*)`)** | JS opt-out: no viewport resize, keyboard overlays, geometry via CSS env vars | Yes (no resize) — but only the Blink side; OS must also not resize | API since Chrome 94; BCD `webview_android: mirror` | Needs `adjustNothing`; then drive layout from `env(keyboard-inset-bottom)` | Medium | Medium (you own focus-scroll) | Medium (feature-detect + flag) |
| **C. `adjustNothing` + VisualViewport/JS-driven** | OS doesn't resize window; read `visualViewport`, set `--keyboard-height` | Yes — window doesn't resize | VisualViewport Chrome 61+; M139+ also resizes visual viewport | Replaces `adjustResize`; edge-to-edge plugin keeps sole inset ownership (no double-handling) | Medium | Medium (own scroll-into-view; pre-M139 may give no signal) | Easy (manifest one-liner) |
| **D. `WindowInsetsAnimationCompat` deferred insets (native)** | Native per-frame translation matched to IME curve | N/A for web reflow — animates the native view | Android 11+ (compat to 10) | Used WITH `adjustResize` | High | High (single WebView; fights web `--keyboard-height`) | Hard |
| **E. CSS containment / compositor hints** | `contain: layout paint`, composite backdrop | Reduces reflow/repaint *cost*, doesn't stop it | All target WebViews | Orthogonal — no manifest/edge-to-edge interaction | Low | Low (over-broad `contain` can shift fixed children / clip overlays) | Trivial |

Why C is the backbone (not A or D): A is likely a no-op in WebView without a
`windowSoftInputMode` change; D adds high-risk native code that fights our
already-JS-driven layout. C achieves the same smoothness in-web and is a
one-line manifest revert.

**Explicitly rejected — re-including `@capacitor/keyboard` on Android.** Tempting
("we already use Capacitor"), but wrong: it was removed on purpose because it
registers an unused insets callback that crashes in `Keyboard$1.onEnd` on some
devices (`capacitor.config.ts:38-40`; cf. capacitor #8055, capacitor-keyboard
#28 on API 35). Its `resize: 'none'/'body'` modes *still* need a
`windowSoftInputMode` change, so it doesn't avoid the flip — it just stacks a
known-flaky native callback on top of it. The visualViewport backbone is
strictly less code.

## Recommended target architecture

The OS stops resizing the WebView window during the IME animation, and the app
drives keyboard-aware layout from the visual-viewport signal it **already**
tracks (`--keyboard-height = innerHeight - visualViewport.height`). This removes
the documented jank source while preserving the existing model, the edge-to-edge
plugin's sole inset ownership (no double-handling regression), and the
add-task-bar pinning.

**Approach C, kept minimal.** No new geometry pipeline. The VirtualKeyboard API
(Approach B) and CSS containment (Approach E) are *contingencies*, not part of
the baseline architecture — adopt them only if measurement/on-device testing
proves they're needed (see Phase 2). Reviewers were unanimous that baking B in
up front is speculative complexity, since current WebViews already give the
height via visualViewport.

## Migration (KISS core first, contingencies behind proven need)

### Phase 0 — Baseline measurement (go/no-go gate, no code)
Capture a DevTools trace (chrome://inspect) of a keyboard open AND close on a
real device, **categorized by Layout / Recalc-Style / Paint / Scripting**. This
confirms the dominant cost before any fix.
- If **Layout** dominates → proceed to Phase 1 (the flip is the right fix).
- If **Paint** (backdrop raster) dominates → the cheap mitigation is the
  contingency in Phase 2c, and the flip may be unnecessary.
- If **Scripting** is large → the `distinctUntilChanged()` win below is in play.
- **Abort/redirect criterion:** if the trace shows the flip wouldn't address the
  dominant cost, stop and pick the matching contingency instead.

### Phase 1 — The KISS core fix
Three small, reversible changes:
1. **Flip `CapacitorMainActivity` `adjustResize` → `adjustNothing`** in
   `AndroidManifest.xml:71`. Leave the legacy F-Droid `FullscreenActivity`
   (`:49`) on `adjustResize` — this static per-activity split *is* the safety net
   (no runtime probe needed yet). The OS stops resizing the window → no per-frame
   ICB reflow.
2. **Generalize `_scrollActiveInputIntoView`** (already exists, iOS-only at
   `global-theme.service.ts:708`) to the Android visual-viewport path, since
   `adjustNothing` won't move content for you. **Scope guard:** apply only to the
   Capacitor Android WebView, NOT Android *mobile-web* (which also runs
   `_initVisualViewportKeyboardTracking` at `:366` but has no manifest flip and
   different viewport behavior).
3. **Extend `_patchCdkViewportForSafeArea`** (`:752`, currently narrows only for
   the iOS overlay offset at `:769-773`) to the Android keyboard, so CDK overlays
   (autocomplete/menus/selects) still position above the keyboard. This is a real
   code change Phase 1 *introduces as a regression risk*, not just a check.

Independent cheap win (ship anytime): add `distinctUntilChanged()` to
`androidInterface.isKeyboardShown$` so the per-frame `OnGlobalLayoutListener`
storm stops rewriting `<body>` classes every frame.

- **On-device checks (device-dependent — test on a recent and an older WebView):**
  - Open/close is smooth (slow-mo; no per-frame stutter of list/backdrop).
  - Focused input near the bottom scrolls above the keyboard on focus AND when
    moving focus between fields while the keyboard stays up.
  - Add-task bar sits exactly above the keyboard, no lag/jump.
  - Backdrop fills behind the keyboard (no blank band now the window doesn't
    shrink).
  - CDK overlays position above the keyboard.
  - Landscape + split-screen/multi-window (intersection is bottom-edge only;
    docked/side keyboards won't resize).
  - **Older WebView specifically:** with `adjustNothing` the IME fully overlays
    and `innerHeight - visualViewport.height` may stay 0 (no height signal) →
    inputs silently covered. If found on a *shipping* WebView, that device is the
    trigger for Phase 2.
- **Biggest risk:** the no-height-signal case above. **Abort criterion:** if a
  supported shipping WebView shows a dead signal, revert this activity to
  `adjustResize` and move to Phase 2 — do not ship Phase 1 alone to that device.

### Phase 2 — Contingencies (adopt ONLY if Phase 0/1 prove the need)
- **2a — VirtualKeyboard API + runtime probe** *(only if Phase 1 found a shipping
  no-signal WebView).* Where `'virtualKeyboard' in navigator`, prefer
  `env(keyboard-inset-bottom)` / `geometrychange` as the `--keyboard-height`
  source. **Do NOT set `overlaysContent=true` until the activity is already on
  `adjustNothing`** — setting it while still on `adjustResize` makes Blink and the
  OS disagree and double-offsets the bar. Gate the flip behind a runtime probe
  (API present, or a focus-time visualViewport-resize check) that falls back to
  `adjustResize`. Note `env(keyboard-inset-*)` read 0 until `overlaysContent` is
  set, so verify in that order.
- **2b — Transition reconciliation** *(polish).* Re-evaluate the add-task-bar
  `transition: bottom 225ms`: keep it, or drive `bottom` from
  `env(keyboard-inset-bottom)` 1:1. Decide on-device.
- **2c — CSS containment** *(only if Phase 0 showed Paint/Layout cost worth
  scoping).* `contain: layout paint` on large keyboard-affected containers —
  keep it OFF any ancestor of the add-task bar and the CDK overlay root (it can
  create a containing-block/scroll context that shifts fixed children or clips
  overlays).

## Cross-cutting invariant (carry through all phases)

The Android WebView insets doc warns: because keyboard visibility now triggers
visual-viewport resize events, code must **not react to those resizes by
clearing focus** (focus → resize → `blur()` → keyboard hides → loop). Today the
Android path's `onViewportResize` (the locally-scoped listener in
`_initVisualViewportKeyboardTracking`) only sets a CSS var, and the Android
`isKeyboardShown$` subscriber only toggles body classes — both safe, no `blur()`.
(`_visualViewportResizeListener` is the separate *iOS* listener.) Preserve the
no-focus-clearing invariant in any change.
([Android WebView insets doc](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets))

## Files

- `android/app/src/main/AndroidManifest.xml` — `windowSoftInputMode="adjustResize"`
  on `FullscreenActivity` (line 49) and `CapacitorMainActivity` (line 71) — the
  Phase 1 lever (flip line 71 only).
- `src/app/core/theme/global-theme.service.ts` — `_scrollActiveInputIntoView`
  (`:708`, iOS helper to generalize, Phase 1); `_patchCdkViewportForSafeArea`
  (`:752`, extend to Android, Phase 1); `_initVisualViewportKeyboardTracking`
  (`:645`, Phase 2a source change + probe).
- `src/app/features/android/android-interface.ts` — `isKeyboardShown$`
  `BehaviorSubject` (`:167`) — add `distinctUntilChanged()` (cheap win).
- `src/index.html` — viewport meta (line 8); where an `interactive-widget` key
  would go if Approach A is ever tested.
- `src/app/features/tasks/add-task-bar/add-task-bar.component.scss` —
  `bottom: calc(var(--keyboard-height) + var(--s2))` + `transition` (Phase 2b).

## Constraint: cannot be verified in CI / dev sandbox

Gradle cannot run in the Claude dev sandbox, so Phases 1–2 must be validated on a
real device (ideally one recent and one older WebView, to cover the
visual-viewport-resize boundary). Weight each phase by reversibility accordingly.

## Sources

- [Viewport resize behavior changes — Chrome for Developers](https://developer.chrome.com/blog/viewport-resize-behavior)
- [viewport-resize-behavior explainer (WICG)](https://github.com/bramus/viewport-resize-behavior/blob/main/explainer.md)
- [Intent to Ship: OSK resizes visual viewport + meta opt-out — blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/ge7xTu-VhJ0)
- [Understand window insets in WebView — Android (M139 IME resize, focus-clearing warning)](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)
- [VirtualKeyboard API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- [VirtualKeyboard.overlaysContent — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard/overlaysContent)
- [browser-compat-data: VirtualKeyboard (webview_android: mirror, added 94)](https://github.com/mdn/browser-compat-data/blob/main/api/VirtualKeyboard.json)
- [The Virtual Keyboard API — Ahmad Shadeed (env(keyboard-inset-*) patterns + caveats)](https://ishadeed.com/article/virtual-keyboard-api/)
- [Synchronize animations with the software keyboard — Android (WindowInsetsAnimationCompat)](https://developer.android.com/develop/ui/views/layout/sw-keyboard)
- [content-visibility & CSS containment — web.dev](https://web.dev/articles/content-visibility)
- [crbug 40287394: WebView can't resize the Visual Viewport on keyboard appear](https://issues.chromium.org/issues/40287394)
- [Capacitor #8055: WebView doesn't resize correctly when keyboard shown on Android](https://github.com/ionic-team/capacitor/issues/8055)
- [capacitor-keyboard #28: keyboard inaccurately resizing webview on Android API 35](https://github.com/ionic-team/capacitor-keyboard/issues/28)
