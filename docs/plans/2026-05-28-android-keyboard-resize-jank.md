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
the remaining _choppiness_.
**Already shipped (commit `80b08f0e96`):** white-flash fix — the native WebView
surface is now painted in the theme background (`values`/`values-night`
`windowBackground` color + a `NavigationBar.setWebViewBackgroundColor` push kept
in sync with the JS theme). Verified to compile (`./gradlew
:app:compilePlayDebugKotlin`); still needs an on-device flash smoke-test.
A `body::before` backdrop-compositing tweak (`will-change: transform`) was tried
in the same commit and then **reverted** — review showed it's a no-op for the
jank (the backdrop resizes every frame, so it re-rasterizes regardless of layer)
while adding an always-on compositor layer on every platform.

## TL;DR

The jank is **not** a CSS problem and **not** fixable from the web layer alone.
It is the native `windowSoftInputMode=adjustResize` resizing the whole WebView
window on every frame of the IME slide → the layout viewport shrinks each frame
→ the entire Angular tree relayouts and the full-viewport backdrop repaints per
frame.

Since Chrome 108 the _browser_ resizes only the visual viewport for the keyboard
(precisely to avoid this jank), but that change **explicitly excludes Android
WebView** — the host app owns the behavior via `windowSoftInputMode`. So the
real lever is native: switch the Capacitor activity from `adjustResize` to
`adjustNothing` and drive all keyboard-aware layout from the visual-viewport /
keyboard-inset signal the app already tracks (`--keyboard-height`).

**Correction (post-implementation review):** the "just flip + reuse
visualViewport" KISS path is **not viable for this app's support matrix.** The
WebView gate is `MIN_CHROMIUM_VERSION = 107` (`WebViewCompatibilityChecker.kt:26`),
but the automatic IME visual-viewport resize in WebView only landed ~Chrome 139.
Today `--keyboard-height` works _because_ `adjustResize` shrinks the window (and
thus the visual viewport). Switch to `adjustNothing` and Chrome 107–138 lose the
window resize **and** don't auto-resize the visual viewport → `innerHeight -
visualViewport.height` stays 0 → keyboard silently covers inputs. So the
**VirtualKeyboard API (Chrome 94+, covers the whole 107+ range) is required, not
optional.**

**Non-regressive design = runtime-gated, not a static manifest flip.** Keep
`adjustResize` in the manifest as the fallback; at runtime, _only if_
`'virtualKeyboard' in navigator`, set `overlaysContent = true`, switch the
activity to `adjustNothing` via a **new native plugin method**, and drive
`--keyboard-height` from VirtualKeyboard `geometrychange`. WebViews without the
API stay on `adjustResize` (current behavior, no regression). Gate the whole
effort behind a **baseline DevTools trace** confirming layout reflow (not paint)
dominates — and weigh the cheaper "keep `adjustResize` + CSS containment" route
(Phase 1) first, since the flip is now a larger native+web change.

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
  _layout reflow_ of the shrinking ICB. The full-viewport `body::before` repaint
  is a weaker leg — see the compositing caveat above. A **baseline DevTools
  trace must attribute Layout vs Recalc-Style vs Paint vs Scripting before we
  commit to the fix**, so we don't optimize the wrong thing.
- A likely-underweighted **third leg** (review): `CapacitorMainActivity`'s
  `OnGlobalLayoutListener` fires on _every_ layout pass during the slide and
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
VirtualKeyboard API only suppress the _Blink_ viewport resize — neither
overrides the native window resize in a WebView. The fix is primarily a native
`windowSoftInputMode` decision, optionally hardened by a web-platform mechanism.

## Approach comparison

| Approach                                                                      | Mechanism                                                                    | Stops per-frame reflow?                                            | WebView support                                                | Interaction w/ adjustResize + edge-to-edge                                                   | Effort | Risk                                                                | Reversibility                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- | ------------------------------ |
| **A. `interactive-widget=overlays-content` meta**                             | Tells Blink not to resize viewport                                           | Only the Blink resize — OS still resizes window under it           | Blink feature (Chrome 108+); intent says not wired for WebView | Must ALSO change `windowSoftInputMode` or it's a no-op                                       | Low    | High (likely no-op alone)                                           | Trivial                        |
| **B. VirtualKeyboard API (`overlaysContent=true` + `env(keyboard-inset-*)`)** | JS opt-out: no viewport resize, keyboard overlays, geometry via CSS env vars | Yes (no resize) — but only the Blink side; OS must also not resize | API since Chrome 94; BCD `webview_android: mirror`             | Needs `adjustNothing`; then drive layout from `env(keyboard-inset-bottom)`                   | Medium | Medium (you own focus-scroll)                                       | Medium (feature-detect + flag) |
| **C. `adjustNothing` + VisualViewport/JS-driven**                             | OS doesn't resize window; read `visualViewport`, set `--keyboard-height`     | Yes — window doesn't resize                                        | VisualViewport Chrome 61+; M139+ also resizes visual viewport  | Replaces `adjustResize`; edge-to-edge plugin keeps sole inset ownership (no double-handling) | Medium | Medium (own scroll-into-view; pre-M139 may give no signal)          | Easy (manifest one-liner)      |
| **D. `WindowInsetsAnimationCompat` deferred insets (native)**                 | Native per-frame translation matched to IME curve                            | N/A for web reflow — animates the native view                      | Android 11+ (compat to 10)                                     | Used WITH `adjustResize`                                                                     | High   | High (single WebView; fights web `--keyboard-height`)               | Hard                           |
| **E. CSS containment / compositor hints**                                     | `contain: layout paint`, composite backdrop                                  | Reduces reflow/repaint _cost_, doesn't stop it                     | All target WebViews                                            | Orthogonal — no manifest/edge-to-edge interaction                                            | Low    | Low (over-broad `contain` can shift fixed children / clip overlays) | Trivial                        |

Why C is the backbone (not A or D): A is likely a no-op in WebView without a
`windowSoftInputMode` change; D adds high-risk native code that fights our
already-JS-driven layout. C achieves the same smoothness in-web and is a
one-line manifest revert.

**Explicitly rejected — re-including `@capacitor/keyboard` on Android.** Tempting
("we already use Capacitor"), but wrong: it was removed on purpose because it
registers an unused insets callback that crashes in `Keyboard$1.onEnd` on some
devices (`capacitor.config.ts:38-40`; cf. capacitor #8055, capacitor-keyboard
#28 on API 35). Its `resize: 'none'/'body'` modes _still_ need a
`windowSoftInputMode` change, so it doesn't avoid the flip — it just stacks a
known-flaky native callback on top of it. The visualViewport backbone is
strictly less code.

## Recommended target architecture

The OS stops resizing the WebView window during the IME animation, and the app
drives keyboard-aware layout from a keyboard-inset signal — removing the
documented per-frame reflow while preserving the edge-to-edge plugin's sole
inset ownership (no double-handling) and the add-task-bar pinning.

**Approach B+C, runtime-gated (see the TL;DR correction).** Because the support
matrix starts at Chrome 107 and visualViewport-under-`adjustNothing` only signals
on ~Chrome 139+, the VirtualKeyboard API (Chrome 94+) is the **required** height
source, not a contingency. Capability-gate it: keep `adjustResize` in the
manifest; at runtime, only when `'virtualKeyboard' in navigator`, set
`overlaysContent = true`, switch the activity to `adjustNothing` via a native
plugin method, and read `--keyboard-height` from `geometrychange`. No-API
WebViews stay on `adjustResize` unchanged. CSS containment (Approach E) stays a
cheaper alternative to measure first.

## Migration (cheapest verified step first; the flip is now a larger change)

### Phase 0 — Baseline measurement (go/no-go gate, no code)

Capture a DevTools trace (chrome://inspect) of a keyboard open AND close on a
real device, **categorized by Layout / Recalc-Style / Paint / Scripting**. This
confirms the dominant cost before any fix.

- **Layout** dominates → only the `adjustNothing` switch (Phase 2) truly removes
  it, but try Phase 1 first to see how far cheap mitigation gets.
- **Paint** dominates → Phase 1's containment is the targeted, low-risk fix and
  the flip may be unnecessary.
- **Scripting** large → already partly addressed by the shipped
  `distinctUntilChanged` (commit `f486496b7b`); check whether the native
  `OnGlobalLayoutListener` JNI round-trip also needs native debouncing.

### Phase 1 — Cheap, low-risk mitigations (no mechanism change)

- **Done — `distinctUntilChanged()`** on the Android `isKeyboardShown$`
  subscription (`global-theme.service.ts`, commit `f486496b7b`): the subscriber
  no longer rewrites `<body>` classes every frame of the slide.
- **CSS containment** _(if Phase 0 shows it helps)._ `contain: layout paint` on
  large keyboard-affected containers to scope reflow/repaint cost while staying
  on `adjustResize`. Keep it OFF any ancestor of the add-task bar and the CDK
  overlay root (it can create a containing-block/scroll context that shifts fixed
  children or clips overlays).
- **On-device check:** re-trace; if open/close is now acceptably smooth, **stop
  here** — the higher-risk Phase 2 becomes unnecessary.

### Phase 2 — Runtime-gated `adjustNothing` + VirtualKeyboard (only if Phase 1 is insufficient)

This is the real reflow fix, but a coupled native+web change that is **100%
on-device-gated** and must be built with a device in the loop. Because the
support matrix starts at Chrome 107 (< the ~139 that auto-resizes the visual
viewport under `adjustNothing`), the VirtualKeyboard API is the required signal
source, and the switch must be **runtime-gated so no-API WebViews keep
`adjustResize` unchanged**:

1. **New native plugin method** to set `windowSoftInputMode` at runtime
   (`SOFT_INPUT_ADJUST_NOTHING`) on `CapacitorMainActivity`. The manifest stays
   `adjustResize` (the fallback); only this call flips capable devices.
2. **Capability gate (web):** only when `'virtualKeyboard' in navigator` — set
   `navigator.virtualKeyboard.overlaysContent = true`, call (1), and drive
   `--keyboard-height` from the `geometrychange` `boundingRect`. Order matters:
   `env(keyboard-inset-*)` / `boundingRect` read 0 until `overlaysContent` is set,
   and never set `overlaysContent=true` while still on `adjustResize` (Blink and
   the OS disagree → double-offset bar). Lands in/near
   `_initVisualViewportKeyboardTracking` (`:645`); leave the existing
   visualViewport path as the M139+/mobile-web fallback.
3. **Generalize `_scrollActiveInputIntoView`** (`:708`, iOS-only) to the Android
   WebView path — `adjustNothing` won't move content for you. **Scope guard:**
   Capacitor Android WebView only, NOT Android _mobile-web_ (also runs the
   tracker at `:366` but gets no flip and is handled by the browser). This is the
   one genuinely iterative piece (scrolling a focused input above an _overlay_
   keyboard needs real-device tuning).
4. **Extend `_patchCdkViewportForSafeArea`** (`:752`, iOS-only narrowing at
   `:769-773`) to subtract the Android keyboard height so CDK overlays
   (autocomplete/menus/selects) stay above the keyboard once the window no longer
   shrinks.
5. **Transition reconciliation** _(polish)._ Re-evaluate the add-task-bar
   `transition: bottom 225ms`: keep it, or drive `bottom` from
   `env(keyboard-inset-bottom)` 1:1. Decide on-device.

- **On-device checks (test on a recent AND an older/Chrome-107-ish WebView):**
  smooth open/close; focused input scrolls above the keyboard on focus and on
  field-to-field moves; add-task bar pinned exactly above the keyboard; backdrop
  fills behind the keyboard; CDK overlays clear the keyboard; landscape +
  split-screen/multi-window; and confirm a no-VirtualKeyboard WebView stays on
  `adjustResize` with today's behavior intact.
- **Biggest risk:** a capable-looking WebView whose VirtualKeyboard signal is
  flaky. **Abort criterion:** if a supported device misbehaves, the runtime gate
  must leave it on `adjustResize` — never ship a covered-input state.

## Cross-cutting invariant (carry through all phases)

The Android WebView insets doc warns: because keyboard visibility now triggers
visual-viewport resize events, code must **not react to those resizes by
clearing focus** (focus → resize → `blur()` → keyboard hides → loop). Today the
Android path's `onViewportResize` (the locally-scoped listener in
`_initVisualViewportKeyboardTracking`) only sets a CSS var, and the Android
`isKeyboardShown$` subscriber only toggles body classes — both safe, no `blur()`.
(`_visualViewportResizeListener` is the separate _iOS_ listener.) Preserve the
no-focus-clearing invariant in any change.
([Android WebView insets doc](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets))

## Files

- `android/app/src/main/AndroidManifest.xml` — `windowSoftInputMode="adjustResize"`
  on `FullscreenActivity` (line 49) and `CapacitorMainActivity` (line 71). Stays
  `adjustResize` (the fallback); Phase 2.1 flips capable devices at runtime.
- `android/app/src/main/java/.../plugins/NavigationBarPlugin.kt` — home for the
  new runtime `setSoftInputMode` plugin method (Phase 2.1).
- `src/app/core/theme/global-theme.service.ts` — `_initVisualViewportKeyboardTracking`
  (`:645`, VirtualKeyboard source + capability gate, Phase 2.2);
  `_scrollActiveInputIntoView` (`:708`, iOS helper to generalize, Phase 2.3);
  `_patchCdkViewportForSafeArea` (`:752`, extend to Android, Phase 2.4); the
  Android `isKeyboardShown$` subscription (`distinctUntilChanged` — done).
- `src/index.html` — viewport meta (line 8); where an `interactive-widget` key
  would go if Approach A is ever tested.
- `src/app/features/tasks/add-task-bar/add-task-bar.component.scss` —
  `bottom: calc(var(--keyboard-height) + var(--s2))` + `transition` (Phase 2.5).

## Constraint: cannot be verified in CI / dev sandbox

Gradle cannot run in the Claude dev sandbox, so Phase 2 must be validated on a
real device (ideally one recent and one ~Chrome-107 WebView, to cover the
VirtualKeyboard/visual-viewport-resize boundary). The shipped Phase 1
`distinctUntilChanged` is unit-verifiable; the rest is device-gated.

## Sources

- [Viewport resize behavior changes — Chrome for Developers](https://developer.chrome.com/blog/viewport-resize-behavior)
- [viewport-resize-behavior explainer (WICG)](https://github.com/bramus/viewport-resize-behavior/blob/main/explainer.md)
- [Intent to Ship: OSK resizes visual viewport + meta opt-out — blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/ge7xTu-VhJ0)
- [Understand window insets in WebView — Android (M139 IME resize, focus-clearing warning)](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)
- [VirtualKeyboard API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- [VirtualKeyboard.overlaysContent — MDN](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard/overlaysContent)
- [browser-compat-data: VirtualKeyboard (webview_android: mirror, added 94)](https://github.com/mdn/browser-compat-data/blob/main/api/VirtualKeyboard.json)
- [The Virtual Keyboard API — Ahmad Shadeed (env(keyboard-inset-\*) patterns + caveats)](https://ishadeed.com/article/virtual-keyboard-api/)
- [Synchronize animations with the software keyboard — Android (WindowInsetsAnimationCompat)](https://developer.android.com/develop/ui/views/layout/sw-keyboard)
- [content-visibility & CSS containment — web.dev](https://web.dev/articles/content-visibility)
- [crbug 40287394: WebView can't resize the Visual Viewport on keyboard appear](https://issues.chromium.org/issues/40287394)
- [Capacitor #8055: WebView doesn't resize correctly when keyboard shown on Android](https://github.com/ionic-team/capacitor/issues/8055)
- [capacitor-keyboard #28: keyboard inaccurately resizing webview on Android API 35](https://github.com/ionic-team/capacitor-keyboard/issues/28)
