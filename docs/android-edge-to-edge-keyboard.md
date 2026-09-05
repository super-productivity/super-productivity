# Android edge-to-edge + soft keyboard (IME)

How the global add-task bar is positioned over the keyboard, and the full #8508
saga. **Read this before touching anything keyboard/IME-related on Android — this
area has regressed repeatedly (#8295, then #8508).**

> **Update (2026-06-22): migrated off `@capawesome/...edge-to-edge-support` to
> Capacitor's built-in `SystemBars`** (`insetsHandling: 'css'`). Edge-to-edge
> insets + IME padding are now handled by SystemBars on **WebView ≥ 140** (or
> API ≥ 35); the **WebView < 140 / API < 35** tail is covered by env() + a native
> keyboard shim (`adjustWebViewHeightForKeyboard`, gated by `NativeInsetShimGate`
> to exactly that tail so it never fights SystemBars). Bar backgrounds are no longer
> painted by a plugin (SystemBars has no color API) — the bars are transparent
> and the theme color shows through via `NavigationBarPlugin.setWebViewBackgroundColor`
> (window decor + WebView surface). The #8508 sections below describe the _former_
> `@capawesome` mechanics and are kept as history. The migration and device-matrix
> verification landed in [PR #8543](https://github.com/super-productivity/super-productivity/pull/8543).

> **⚠️ Do NOT inset the WebView for the IME based on an assumption that the
> system "doesn't resize on Android 15/16."** Real devices (incl. a Pixel-class
> Android 16 phone) still resize the window for the keyboard. Insetting on top of
> that double-counts and squashes the WebView. See #8508 below. Any future inset
> must _detect_ whether the window already resized.

## How the bar is positioned

The global add-task bar is `position: fixed` and lifted off the bottom by a CSS
variable only:

```scss
// add-task-bar.component.scss
:host-context(.isTouchOnly).global {
  bottom: calc(var(--keyboard-height) + var(--s2));
}
```

`--keyboard-height` defaults to `0px`. On Android/web it is set by
`GlobalThemeService._initVisualViewportKeyboardTracking()`
(`src/app/core/theme/global-theme.service.ts`) from
`obscured = window.innerHeight - visualViewport.height`, with a 100px floor
(`KEYBOARD_THRESHOLD_PX` — `obscured <= 100` is treated as `0`). On iOS the
Capacitor Keyboard plugin sets it.

So the bar floats above the keyboard if **either** the window/WebView shrinks
(then `bottom: 0` is already above the IME) **or** the visual viewport shrinks
(then `--keyboard-height` lifts the bar). On the devices we have tested, the
window **does** shrink (the system resizes for the IME), so `--keyboard-height`
stays `0` and the bar sits correctly at `bottom: var(--s2)`.

## #8508 — reversed / invisible characters (the actual root cause)

**Symptom.** On Android, the add-task bar (and search) showed reversed or
invisible characters; some users reported "I can't see what I'm writing and Enter
does nothing." Reported on v18.11.0 only (Pixel 10/Android 17, Galaxy S23 Ultra,
Pixel 8a, Tab S5e/Android 15).

**Root cause.** v18.11.0 shipped a `patch-package` patch (commit `5497212b9`) to
`@capawesome/capacitor-android-edge-to-edge-support` that **always** inset the
WebView by the IME height (`bottomMargin = max(imeInsets.bottom, …)` on every
`OnApplyWindowInsetsListener` callback), to fix the bar sitting _behind_ the
keyboard under _assumed_ enforced edge-to-edge.

On real devices the assumption is false: the system **still resizes the window
for the IME** even on Android 16. Measured on an Android 16 phone with the
keyboard up: `window.innerHeight` went **732 → 141** (and `--keyboard-height`
stayed `0`). The patch then added **another ~909px** inset on top of the already
shrunk window → the WebView was squashed to a ~141px sliver with a huge blank
gap above the keyboard. That squashed layout is almost certainly the
"can't see what I'm writing" report.

**Fix (this change).** The patch was **removed entirely**. The plugin's stock
behavior — `bottomMargin = keyboardVisible ? 0 : max(imeInsets.bottom, …)`, i.e.
no inset while the keyboard is up — lets the system handle the keyboard.
**Verified on an Android 16 phone: gap gone, WebView fills the resized window,
bar sits just above the keyboard (no behind-keyboard regression).**

## Theories that were RULED OUT (don't re-chase)

- **"Angular `ngModel` `writeValue` resets the caret during composition."**
  REFUTED. `NgModel`'s `isPropertyUpdated` guard skips `writeValue` while the
  model equals the just-typed value, and the add-task bar never touches
  `value`/`setSelectionRange`/`focus` mid-composition. Proven with an e2e CDP IME
  probe (since removed) and the unit specs.
- **"Per-keystroke DOM churn (signal updates) during composition."** Not the
  cause. On-device logging showed the WebView does **not** relayout during steady
  typing.
- **An SDK-version gate (inset only on API 36+) and an inset "latch."** Both
  tried and reverted. The gate is wrong because the Android 16 phone _resizes_
  (so it still double-counted there); the latch held a stale keyboard height and
  produced its own gap.

## Open items — if this is NOT fixed for the reporters

1. **Confirm the "reversed characters" symptom on the reporters' devices.** The
   squashed-WebView / gap is verified fixed on the maintainer's Android 16 phone.
   It is **not yet confirmed** that the _reversal_ is gone for all reporters
   (Pixel 10/A17, S23, Pixel 8a, Tab S5e). Ask them to test the next build.
2. **Residual: the system itself resizes on suggestion-strip changes.** Even with
   the patch gone, the logs show the IME inset oscillating (`imeBottom 909↔996`)
   as the suggestion strip toggles — and the _system_ resizes the window each
   time. Typing during that system resize could still disrupt composition. This
   is Android's own `adjustResize`, not our code. If reports persist, this is the
   next lead (e.g. a content-stable layout, or debouncing).
3. **The other v18.11.0 change.** If the reversal persists with the patch gone,
   re-examine the `@angular/* 21.2.11 → 21.2.17` bump (commit `f51954f80`) — the
   only other IME-adjacent change in the release.
4. **Long-term proper fix.** Removing the patch only puts the bar behind the
   keyboard on a device that enforces edge-to-edge **and** whose _visual_ viewport
   also fails to shrink for the IME — otherwise `--keyboard-height` still lifts
   the bar. That is cosmetic and likely rare, vs. the squashed layout on every
   real device tested. The correct inset would be **resize-detecting**: only inset
   when the window did not already shrink for the IME. Web-side detection already
   exists — `GlobalThemeService._isVisualViewportResizedForKeyboard()` — so a
   future native inset can reuse that logic rather than re-derive it. Validate on
   the device matrix below.
5. **Re-enable diagnostics.** Add `android.util.Log.d("SP8508", …)` in
   `EdgeToEdge.applyInsetsInternal` logging `kbVisible` / `imeBottom` /
   `bottomMargin` / whether a relayout fired, then `adb -d logcat -s SP8508`.
   On the web side, `chrome://inspect` →
   `{innerH: innerHeight, vvH: visualViewport.height, kb: getComputedStyle(document.documentElement).getPropertyValue('--keyboard-height')}`.

## #8508 follow-up — SDK 28 (Android 9): add-task bar sits BEHIND the keyboard

**Status: fix implemented (`CapacitorMainActivity.adjustWebViewHeightForKeyboard`),
PENDING ON-DEVICE VALIDATION across the matrix below.** After 18.12.0 (patch
removed) a user on **Android 9 / API 28** reports the global add-task bar sits
_below / behind_ the soft keyboard. This is the realization of open item #4
above, and the device class it predicted.

**Why API 28 specifically.** The bar is positioned _only_ from
`--keyboard-height`, which `GlobalThemeService._initVisualViewportKeyboardTracking()`
derives from `obscured = window.innerHeight - visualViewport.height`. It is
correct iff **either** the window resized for the IME **or** the VisualViewport
shrank. On API 28 _neither_ does:

1. `targetSdk 36` + the `@capawesome` edge-to-edge plugin call
   `setDecorFitsSystemWindows(window, false)` on **all** API levels → the window
   goes edge-to-edge → the system stops resizing for the IME.
2. The plugin _does_ detect the IME on this device
   (`WindowInsetsCompat.Type.ime()` reports visible) and sets WebView
   `bottomMargin = 0` while the keyboard is up — `EdgeToEdge.applyInsetsInternal`:
   "the system already resizes the window for the keyboard". But it does **not**
   resize (point 1), so the WebView keeps its full height and the bar stays put.
   _(An on-device logcat confirmed `keyboardVisible == true` here; the earlier
   guess that `Type.ime()` is simply unreliable < 30 was wrong for this device.)_
3. The WebView's VisualViewport doesn't shrink either →
   `obscured ≈ 0` → `--keyboard-height = 0` → the `position: fixed` bar sits
   behind the keyboard.

**Do NOT "fix" this on the web side.** It is tempting to feed `--keyboard-height`
from a native height fallback (the activity already measures the IME on every
layout pass — `CapacitorMainActivity` `OnGlobalLayoutListener`:
`keypadHeight = screenHeight - rect.bottom`, reliable on every API level). The
trap: `obscured` is `≈0` in **both** the working case (window resized 732→141)
and this broken case (nothing resized), so the web side cannot tell them apart
without tracking a baseline `innerHeight` and computing
`max(obscured, nativeKbHeight - layoutShrink)` — which is **precisely the
reverted #8295 formula in "What NOT to do" below**. On a device that _does_
resize, that double-counts and floats the bar mid-screen. The web layer lacks
the signal to disambiguate; native has it unambiguously.

**Implemented fix (native, explicit WebView height while the IME is up; originally
scoped to API < 30, now gated by `NativeInsetShimGate` — see #9316 below) —
`CapacitorMainActivity.adjustWebViewHeightForKeyboard`.**
Driven from the existing keyboard `OnGlobalLayoutListener`:

- while the keyboard is up: set an explicit WebView **layout height** to the
  keyboard top, `height = rect.bottom − webViewTopOnScreen`
  (`getWindowVisibleDisplayFrame`, reliable on API 28). Shrinking the view shrinks
  the web layout viewport, so the existing CSS resolves the bar above the keyboard
  with no web-side keyboard-height math.
- while the keyboard is down: restore the resting height
  (`webViewLayoutHeightDefault`, captured at startup, e.g. `MATCH_PARENT`), so the
  plugin's normal margin-based layout applies unchanged.
- ~~gated `Build.VERSION.SDK_INT < 30`, so on API >= 30 it is a strict no-op and
  the behavior verified in 18.12.0 is **untouched**.~~ Gate since broadened to
  `SDK < 35 && WebView < 140` (`NativeInsetShimGate`, #9316 below); outside that
  band it still returns before writing anything.

> **Why height, not `bottomMargin` and not the plugin's listener.** The plugin owns
> `webView.bottomMargin` and rewrites it to 0 on every inset dispatch while the IME
> is visible (`EdgeToEdge.applyInsetsInternal`, because it expects the system to
> resize — which enforced edge-to-edge prevents on API < 30). Correcting the margin
> from a second writer made the bar **flicker constantly** (on-device logcat showed
> the margin alternating `0 ↔ lift` every frame); WebView bottom _padding_ doesn't
> move the web layout viewport; and fully replacing the plugin's listener fixed the
> flicker but stopped the plugin re-sizing its status/nav **color overlays**, so the
> navbar showed a **white gap**. Setting an explicit `layout_height` is the way out:
> it is a different property than the margin the plugin manages, and for an
> explicit-height view the bottom margin does not change the view's size — so the two
> never fight, and the plugin keeps doing _everything else_ (insets + color overlays,
> no white gap). The target is read from the visible frame and does not depend on the
> WebView's own height, so it is stable pass-to-pass (no feedback loop).

**Upstream status (why a local workaround at all).** This is a known, repeatedly
regressed area in `@capawesome/capacitor-android-edge-to-edge-support` (pinned
8.0.8): see `capawesome-team/capacitor-plugins` #845/#490/#596/#725/#819 (closed)
and #847 (open). The buggy `keyboardVisible ? 0 : max(ime, navbar)` ternary in
`EdgeToEdge.applyInsetsInternal` is acknowledged — the maintainer redirects to
Capacitor core `ionic-team/capacitor#8466` (fixed for the **built-in** `SystemBars`
by core PR #8481, merged), and plugin PR #848 ("correct WebView margin
calculation") would fix the ternary but is **still open/unreleased**. So there is no
shipped fix on the plugin path we use; this native workaround is independent of that
timeline. Longer term, migrating to Capacitor 8's built-in `SystemBars`
(`insetsHandling`) + dropping the plugin is the maintainer's implied direction.

**Why not the web side:** `obscured` cannot distinguish "window resized" from
"nothing resized", so a web `--keyboard-height` fallback is the reverted #8295
formula. Native has the unambiguous geometry.

**Still REQUIRED before release:** validate across the device matrix below — this
area has silently regressed at #8295 and twice at #8508. Confirm on a real
API < 30 device that the bar lands flush on the keyboard top (no white gap, no
flicker) and that the status/nav-bar layout is unchanged with the keyboard down,
and on an API >= 30 device that nothing changed at all. A debug-only
`Log.d("SUPKeyboard", "webView height …")` reports each height write — in steady
state expect one per show/hide, not a stream. Remove that log before merge.

## #8508 follow-up — fullscreen markdown / notes editor squashed

**Status: CSS fix implemented, PENDING ON-DEVICE VALIDATION.** Reported on #8508:
editing a project (or task) note on Android with the keyboard up, the
`DialogFullscreenMarkdownComponent` toolbar + textarea + Close/Save controls were
squashed into the top of the screen with a large blank gap down to the keyboard.

**Why.** The bar is not the only `position: fixed` surface that must clear the
keyboard — this dialog is `position: fixed; height: 100%` too. Its keyboard rule
subtracted `--keyboard-overlay-offset`, which is set **only on iOS**, so on
Android it was a no-op. With the keyboard up the dialog therefore kept whatever
height `100%` resolved to: full (content behind the keyboard) on a non-resizing
device, or the squashed sliver on the buggy v18.11.0 WebView.

**Fix (`dialog-fullscreen-markdown.component.scss`).** Use the same
resize-detecting `--keyboard-height` the add-task bar uses for the
Android / mobile-web case; keep the iOS `--keyboard-overlay-offset` path in a
separate rule. iOS carries **both** `isNativeMobile` and `isIOS` (and sets
`--keyboard-height` non-zero on the CDK overlay container this dialog lives in —
never on `<html>`, see `IosKeyboardService`), so the Android rule excludes iOS with
`:not(.isIOS)` — the two rules are mutually exclusive and order-independent
(rather than relying on equal-specificity source order):

```scss
:host-context(body.isNativeMobile:not(.isIOS).isKeyboardVisible) {
  height: calc(100% - var(--keyboard-height, 0px));
}
:host-context(body.isIOS.isKeyboardVisible) {
  height: calc(100% - var(--keyboard-overlay-offset, 0px) - var(--safe-area-top));
}
```

This is **not** the reverted-#8295 trap above: it reads the pure VisualViewport
`--keyboard-height`, never augments it with native data. Coverage across the
device classes this doc tracks:

- **API < 35 + WebView < 140** (originally API < 30 for the SDK 28 report;
  broadened for #9316) — the native shim shrinks the WebView layout height, so
  `100%` is already above the keyboard and `--keyboard-height == 0`; the rule is
  `100% - 0`. Works.
- **API >= 30, window resizes** (verified 18.12.0) — `--keyboard-height == 0`,
  so `100% - 0`. Works.
- **API >= 30, no resize but VisualViewport shrinks** (open item #4) —
  `--keyboard-height > 0` lifts the dialog above the keyboard, on par with the
  add-task bar.

**Do NOT also subtract `--safe-area-top` here.** An earlier version of this fix
did (`100% - --keyboard-height - --safe-area-top`). That is a double-count:
`:host` is `border-box` (global `* { box-sizing: border-box }`) and already has
`padding-top: var(--safe-area-top)`, so the top inset is _inside_ `height: 100%`.
Subtracting it again left a `--safe-area-top`-sized gap between the Close/Save
controls and the keyboard. It was invisible while `--safe-area-top` was 0 on
API < 30, then surfaced the moment the status-bar fix above made it non-zero
(also latent on API >= 30, where env() already gave a non-zero `--safe-area-top`).
The iOS rule keeps its `- --safe-area-top` term for now — its keyboard runtime
differs (the WebView resizes only after the keyboard animation, and
`--keyboard-overlay-offset` covers the case where it never does) and it is
unverified on an iOS device; if an iOS bottom gap appears, drop the term there too.

## #8508 follow-up — SDK 28 (Android 9): header draws BEHIND the status bar

**Status: fix implemented (`CapacitorMainActivity.pushStatusBarOverlap`),
PENDING ON-DEVICE VALIDATION.** Separate from the keyboard — on API 28 the web
header overlaps the **status bar** (no top gap), reported on #8508.

**Root cause.** Post the SystemBars migration, Android no longer writes
`--safe-area-inset-*` from JS; `--safe-area-top` resolves via the SCSS fallback
`var(--safe-area-inset-top, env(safe-area-inset-top, 0px))` (`_css-variables.scss`).
On **API >= 35** SystemBars injects `--safe-area-inset-top`, and on **WebView >= 140**
the WebView's own `env(safe-area-inset-top)` is correct — but on the
**WebView < 140 tail** under enforced edge-to-edge the WebView extends under the
status bar while `env(safe-area-inset-top)` resolves to **0** (old WebViews map
only display _cutouts_ into safe-area insets, not the status bar). So
`--safe-area-top == 0` and content draws under the status bar (Android 9 / API 28).

**Why not a pure web-side fallback.** The web side cannot tell "WebView is
edge-to-edge under the status bar" from "WebView is already inset below it" —
`env()` is 0 in both, and adding the status-bar height blindly would double-count
in the inset case. Native has the geometry.

**Fix (native overlap → SCSS fallback) — `pushStatusBarOverlap`.** From
the existing keyboard `OnGlobalLayoutListener`, measure the overlap
`max(0, rect.top − webViewTopOnScreen)` — `rect.top` is the visible-frame top
(= status-bar height, reliable on API 28; the same frame the keyboard path reads)
and `getLocationOnScreen` is the WebView's top (0 edge-to-edge, == status-bar
height once inset). Publish it (physical px → CSS px, deduped) as the
`--android-status-bar-overlap` CSS var, gated by `NativeInsetShimGate`
(**SDK < 35 AND WebView < 140** since #9316; originally SDK < 30 — mirrors the
keyboard shim, never fights SystemBars). The var is folded into the
SCSS fallback (`_css-variables.scss`) — NOT written from JS, so it never races
SystemBars on `--safe-area-inset-*`:

```scss
--safe-area-top: var(
  --safe-area-inset-top,
  max(env(safe-area-inset-top, 0px), var(--android-status-bar-overlap, 0px))
);
```

- `max()`, not a sum, so it never double-counts: WebView < 140 edge-to-edge →
  env 0, overlap = status bar → status bar; once inset → env 0, overlap 0 → 0.
- On **API >= 35 / WebView >= 140** `--safe-area-inset-top` is set (SystemBars) or
  env() is correct, so `var()` precedence / `max()` ignore the overlap entirely —
  verified behavior untouched.
- JS readers (`_patchCdkViewportForSafeArea`) still parse the `var(max(...))`
  token to 0, so overlay positioning is unchanged — preserving #8283 scoping
  (only the header padding is affected).
- ~~Known small gap: an **API 30–34** device on an **old WebView < 140** also has
  env()==0 but is excluded by the SDK < 30 gate; rare (WebView auto-updates above
  API 30) — broaden the gate to WebView-only if it ever surfaces.~~ **It surfaced
  (#9316); the gate was broadened — see the section below.**
- **Known gap, pre-existing — follow-up, not part of #9316:** SystemBars 8.4 also
  injects `--safe-area-inset-top: 0px` _inline_ on its non-passthrough path at
  **every** API level (`SystemBars.initWindowInsetsListener`: zeroed `newInsets` →
  `injectSafeAreaCSS`, re-fired on `onPageCommitVisible`, `onDOMReady` and each
  IME toggle). `var(--safe-area-inset-top, …)` therefore resolves to `0px` and the
  `max(env(), var(--android-status-bar-overlap))` fallback is never consulted — the
  overlap var published by `pushStatusBarOverlap` is shadowed on exactly the band
  the shim runs on, so the header fix above is most likely inert there. Not yet
  device-verified. To settle it: log
  `getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')`
  on the API 34 emulator; if `0px`, move the overlap out of the fallback, e.g.
  `max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), var(--android-status-bar-overlap, 0px))`
  (safe: the var is only ever written where the gate is on).
- The var lives only as an inline style on the document, so a web-side reload
  (`window.location.reload()` — language change, PWA update, sync-conflict
  recovery) wipes it. The native dedupe (`lastStatusBarOverlapCssPx`) is reset in
  `flushPendingShareIntent()` (runs on every frontend (re)load) so the next layout
  pass re-publishes it; without the reset the unchanged value would be skipped and
  the overlap would regress after a reload.

## #9316 — API 34 + old WebView: add-task bar behind the keyboard

**Status: gate widened (`NativeInsetShimGate`) and VALIDATED IN CI on both inset
owners** — `ImeInsetShimInstrumentedTest`, see "Validation" below (measured
2026-09). Two users on **Android 14 (API 34)** reported the add-task bar (and the
task-detail notes field) sitting behind the keyboard. This is the "known small
gap" above, realized.

**Root cause — nobody owns the IME inset.** `SystemBars` installs its
`OnApplyWindowInsetsListener` on the WebView's parent (the activity content root,
`capacitor_bridge_layout_main.xml`) on **every** API level, so it — not the
framework — is the inset owner. But it only applies IME padding on two paths
(`SystemBars.initWindowInsetsListener`): the passthrough branch, gated
`webViewMajor >= 140 && viewport-fit=cover`, and an `SDK_INT >= 35` branch. On
**API < 35 AND WebView < 140** it applies nothing at all — and our shims were
gated `SDK_INT < 30`, so they did not step in either. Nothing shrinks →
`obscured = innerHeight − visualViewport.height` is 0 → `--keyboard-height: 0` →
the `position: fixed` bar stays at the bottom of a viewport that extends behind
the IME. The reporters' before/after screenshots are pixel-identical, which is
exactly this signature.

**Why `adjustResize` does not save us — read off the sources, then confirmed on
the API 34 emulator (measured 2026-09; see Validation below: the root stayed 640 px
while the visible frame dropped to 405).** The manifest declares
`windowSoftInputMode="adjustResize"`, so the obvious question is why the window
does not simply shrink. Because Capacitor's StatusBar plugin runs with
`overlaysWebView: true` (`capacitor.config.ts`), which applies
`SYSTEM_UI_FLAG_LAYOUT_STABLE or SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN` to the decor
view (`StatusBar.setOverlaysWebView`). The operative flag is `LAYOUT_STABLE`: with
it set the decor view skips the fits-system-windows padding that `adjustResize`
relies on, so the window keeps its full height while the IME is up. That is the
long-standing Android behaviour the `getWindowVisibleDisplayFrame` +
explicit-height workaround exists for, and it is SDK-independent below 35, which
is why the symptom never depended on the API level the original gate keyed off.
Real-device confirmation in the band is still outstanding (the window configuration
does not depend on the WebView version, so any device in the band answers it).

**Why the old gate's assumption failed.** `SDK_INT < 30` encoded "API >= 30
implies a current WebView, because it auto-updates." Not on a custom ROM:
crDroid ships its own `com.android.webview` (124) and the Play-updated
`com.google.android.webview` (150) is _installed but disabled_. Settings shows
150; `dumpsys webviewupdate` shows the **active** provider is 124. Always read
the `Current WebView package` line, never the Settings screen.

**Evidence.** Two independent reporters at API 34 / WebView 124 and 126. One of
them side-loaded WebView 151 with no app change and the bug disappeared — a clean
A/B isolating the WebView version, and a direct confirmation of the 140 boundary.

**Fix — `NativeInsetShimGate.shouldRunShim(sdkInt, webViewMajor)`**, now shared by
`adjustWebViewHeightForKeyboard` and `pushStatusBarOverlap` (both lost their
`BelowApi30` suffix — the gate is no longer SDK 30). It is the complement of
SystemBars' two ownership branches: run iff `sdkInt < 35 && (webViewMajor == null
|| webViewMajor < 140)`. An unreadable version runs the shim, because SystemBars
treats an unreadable version as `0` and skips its passthrough too — both off would
strand the device with no inset owner. Unit-covered in `NativeInsetShimGateTest`.

Two caveats on "complement":

- Branch 1 additionally requires **`viewport-fit=cover`**, which SystemBars only
  learns at `onDOMReady`. `src/index.html` sets it (there is a comment there
  saying so — keep it), leaving only the pre-DOM-ready window uncovered, where the
  IME cannot be up yet.
- The gate must read the **active** provider, the same thing SystemBars reads
  (`WebView.getCurrentWebViewPackage()`, failure treated as `0`).
  `WebViewCompatibilityChecker` answers a different question and can fall back to
  scanning installed packages, which on the crDroid layout above reports the
  disabled 150 rather than the active 124 — that number would switch the shim off
  on exactly the devices it is for. `NativeInsetShimGate.activeProviderMajor()`
  therefore accepts only `getCurrentWebViewPackage()` or user-agent readings and
  degrades anything else to `null` (→ run the shim).

**Why this does not re-arm #8508.** The rule from that saga is that any inset must
be _resize-detecting_. This shim already is, structurally: it sets the WebView's
layout height to an **absolute** target read from the visible frame
(`rect.bottom − webViewTop`), not a delta. On a device where the window already
shrank for the IME, the WebView bottom is already at `rect.bottom`, so the
computed height equals the one in effect. The shim still writes it once — the
resting value is `MATCH_PARENT`, which never equals a px target — but the write is
a no-op in effect: same height, nothing moves, no second inset stacks on the
system's own. That property is what makes a gate mistake harmless in the resize
direction; what keeps the two owners from both acting is the gate itself. Do not
replace the absolute target with a delta-based inset.

**Validation — `ImeInsetShimInstrumentedTest` (CI, both inset owners).** No
device on hand sits in the widened band, and the reporter who offered to test had
moved to WebView 153 by then, where the shim is a no-op by construction and a test
build could only confirm the symptom. The band is reachable in CI instead: an API
34 `google_apis` emulator image ships a bundled WebView that never auto-updates and
sits below 140. The `android-tests` job boots a second emulator at API 34
(`android/run-android-ime-check.sh`) after the API 35 suite
(`android/run-android-checks.sh`), so every PR exercises both owners:

| Emulator                  | Owner per gate         | Measured (2026-09, 640 px root)                                                                       |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| API 34, WebView 113.0     | native shim (on)       | `paramsHeight` MATCH_PARENT → **405** = `rect.bottom`; WebView bottom 640 → 405; `innerHeight` 640 → 405 |
| API 35 (bundled WebView)  | SystemBars (shim off)  | layout params untouched; WebView bottom at `rect.bottom`; `innerHeight` shrinks                       |

The test derives the gate's inputs the way the activity does
(`NativeInsetShimGate.activeProviderMajor(WebViewCompatibilityChecker.evaluate())`)
and asserts the **mechanism** the gate selects — an explicit WebView height equal
to `ImeWebViewHeight.targetHeight(rect.bottom, webViewTop)` under the shim,
untouched layout params where SystemBars owns the inset — plus, on every API
level, the **symptom**: WebView bottom _at_ the keyboard top (within 2 px, both
directions — a WebView ending well above it is the #8508 double-inset squash and
fails too), `window.innerHeight` shrank (what lifts the `position: fixed` bar),
the height stable across a later layout pass (no feedback loop, and the shim still
off where SystemBars owns the inset), and the resting height restored on hide. The
API 34 step also passes `expectShim=true` as an instrumentation argument, so the
test fails rather than silently switching branch if that image is ever refreshed
with a WebView ≥ 140. Emulators report a hardware keyboard, so both scripts run
`settings put secure show_ime_with_hard_keyboard 1` first; without it the IME
never opens and the test fails on its first wait rather than passing vacuously.

The API 34 row is also what settled the "`adjustResize` does not resize" question
above: the window kept its full 640 px until the shim pinned it (had the framework
resized, `paramsHeight` would still read `target`, but `webViewHeight` would
already have equalled it before the shim's pass). Real-device confirmation in the
band is still outstanding; the reporters' A/B with WebView 151/153 remains the
field evidence.

**On a reporter's device, validate the mechanism, not just the symptom.** The
shim's write changes nothing visible wherever the window already resizes, so "the
bar looks fixed" cannot distinguish a working shim from one that never ran — and a
coincidental fix would send the next regression hunt down the wrong path.
`logImeGeometryOnTransition` prints the gate inputs and geometry once per keyboard
transition; it is off unless enabled, so ask the reporter for:

```
adb shell setprop log.tag.SUPKeyboard DEBUG   # no restart needed: read live
adb logcat -s SUPKeyboard
adb shell dumpsys webviewupdate | grep -i 'Current WebView package'
```

The line is printed **after** the shim's pass, so on a fixed device the
`ime=true` line reads `shim=true` with `paramsHeight` equal to `target` (both
`rectBottom − webViewTop`). Cases to distinguish:

- `shim=false` → the gate is off: compare `wvMajor=` against the `dumpsys`
  provider. The version source is wrong, not the theory.
- `target` set but `paramsHeight` unchanged (still `-1`) → the shim bailed on a
  degenerate frame on that pass. Note a device that resized itself does **not**
  look like this: the shim still writes `paramsHeight == target` there; what tells
  it apart is `webViewHeight` already equalling `target` _before_ the shim's pass
  (see `ImeWebViewHeight`).
- no line at all → the listener never saw a transition; check the tag is enabled
  (`Log.isLoggable` reads the property live, no restart needed) and that the
  keyboard actually crossed the 15% threshold.

`webViewHeight` lags by one layout pass — that is expected, not a failure.

## What NOT to do

Do not stack a second/third keyboard-height source on top of the VisualViewport
signal (native physical-px height + a `baseInnerHeight`-tracking path combined as
`max(obscured, nativeKeyboardHeight - layoutShrink)`). That was #8295; the
sources race on separate async events, the baseline gets reset to the shrunk
`innerHeight` mid-animation, the double-count guard collapses, and the bar is
mispositioned. It was reverted. Fix the inset at the source, and **only after
detecting** whether the system already resized.

## SystemBars inset-source risks (unconfirmed on device)

Carried over from the 2026-06 SystemBars migration review. These are device-matrix
items to **check**, not to blind-fix — a blind fix risks re-creating #8508.

1. **API >= 35 + WebView < 140 double-count (narrow band).** In SystemBars'
   non-passthrough branch (API >= 35) it `setPadding`s the WebView parent _and_
   injects `--safe-area-inset-*`. If the web also pads via `var(--safe-area-*)`,
   that double-counts. The common API 36 case is WebView >= 140 = passthrough (no
   static parent padding, so no double-count), making this the stale-WebView
   corner. This is what `--bottom-nav-safe-area` in `src/styles/_css-variables.scss`
   halves the inset for. Verify on an API 35/36 device with an old WebView; if it
   is real, gate the web padding off on that band rather than removing it globally.
2. **`env(safe-area-inset-bottom)` vs `var(--safe-area-bottom)` consumers diverge
   on API >= 35.** Some SCSS reads raw `env()`, other SCSS reads
   `var(--safe-area-*)`. On API >= 35 SystemBars can zero the passed-through
   insets while injecting real px into the vars, so the two families disagree.
   Confirm bottom-nav / add-task-bar spacing on API 35/36; reconcile to one source
   per band if it is wrong.
3. ~~**API 30-34 + WebView < 140 IME owner.** The native shim is gated
   `SDK_INT < 30` deliberately (newer APIs were observed to resize the window for
   the IME, and insetting on top of that re-creates the #8508 squash). Under
   SystemBars, WebView < 140 gets no IME padding below API 35. Verify whether the
   window still resizes on API 30-34: if it does, there is no gap; if it does not,
   extend the shim to `< 35 && WebView < 140` — but only after confirming on a
   device.~~ **Done (#9316):** the window does not resize there; the shim is gated
   `< 35 && WebView < 140` (`NativeInsetShimGate`) and validated on the API 34
   emulator — see the #9316 section.
4. **CDK overlay / context-menu top position shifts on API >= 35.**
   `--safe-area-inset-top` resolves to real px there (it was 0 on Android before),
   so connected overlays clamp below the status bar. Likely more correct; re-test
   the overlay matrix.

## Device test matrix (required before merging IME changes)

Behavior differs across devices — test the add-task bar opening the keyboard, and
typing a word fast right after tapping +, on:

- Android 10 (API 29) — pre-edge-to-edge; `Type.ime()` insets are unreliable here
- Android 14 (API 34) — edge-to-edge opt-out still possible
- Android 15 (API 35) — we opt out via `windowOptOutEdgeToEdgeEnforcement`
- Android 16 (API 36) — our target; the system was observed to still resize for
  the IME on a real device

**The WebView version is a second axis, not a detail (#9316).** SystemBars
branches on it at 140, so an API 30–34 device on WebView < 140 behaves nothing
like the same device on WebView >= 140 — that combination is what #9316 was, and
it is the one the SDK-only matrix missed. Read the active provider with
`adb shell dumpsys webviewupdate` (the `Current WebView package` line) — **not**
the Settings screen, which can show an installed-but-disabled package. Custom
ROMs are the realistic source of an old WebView above API 30.

Both gesture-nav and 3-button-nav, light and dark. Confirm: no blank gap above
the keyboard, bar visible just above the keyboard, and typed characters appear in
order (not reversed).
