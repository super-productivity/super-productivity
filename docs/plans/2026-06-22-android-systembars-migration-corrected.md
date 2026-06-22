# Android edge-to-edge: migrate `@capawesome` → Capacitor `SystemBars` (corrected plan)

**Date:** 2026-06-22
**Status:** PLAN ONLY — not started. Supersedes the migration section (§5) of the
PR-8528 handover, which was written before the `SystemBars` WebView/API gating
(below) was known.
**Prereq reading:** [`docs/android-edge-to-edge-keyboard.md`](../android-edge-to-edge-keyboard.md)
(the #8508 saga and the "never blindly inset the WebView for the IME" rule).

---

## TL;DR

- Dropping the thrice-regressed `@capawesome/capacitor-android-edge-to-edge-support`
  plugin for Capacitor 8's built-in `SystemBars` is the right **long-term**
  direction (one fewer fragile dependency in the area that regressed at #8295 and
  twice in #8508).
- **It is a device-validated spike, not a config swap.** A naive "remove the plugin,
  flip `insetsHandling` to `'css'`" **regresses a supported slice of the fleet** —
  see the gating model below.
- **The reported API<30 keyboard bug should ship independently** via the native
  height workaround (`adjustWebViewHeightForKeyboardBelowApi30`, PR #8528). It is
  WebView-version-independent; the migration's keyboard handling is **not**. Keep
  that workaround inside the migration too — do not bank on Capacitor core #8481.

---

## Why the naive plan is wrong: the `SystemBars` inset model

Verified by reading the bundled source
`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java`
(constants `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX = 140`,
`WEBVIEW_VERSION_WITH_SAFE_AREA_KEYBOARD_FIX = 144`; logic in
`initWindowInsetsListener()` lines 177–231).

`SystemBars` does **not** handle insets unconditionally. Its window-insets listener
branches on `shouldPassthroughInsets = (WebView major ≥ 140) && viewport-fit=cover`
(the app has `viewport-fit=cover`, `src/index.html:8`):

| Device state | Static bar insets | Keyboard / IME inset |
| --- | --- | --- |
| **WebView ≥ 140** (passthrough) | native `env(safe-area-inset-*)` passed through, all API levels | `setPadding(…, imeInsets.bottom)` on the WebView parent — **works on all API levels** (incl. API 28) |
| **WebView < 140**, **API ≥ 35** | `setPadding` + injects `--safe-area-inset-*` CSS vars | handled |
| **WebView < 140**, **API < 35** | **nothing** (insets zeroed & consumed) | **nothing** |

The killer mismatch: this app **officially supports WebView 107+** and only *warns*
below 110 (`WebViewCompatibilityChecker.kt`: `MIN_CHROMIUM_VERSION = 107`,
`RECOMMENDED_CHROMIUM_VERSION = 110`). `SystemBars` edge-to-edge only engages at
WebView **140**. So **WebView 107–139 on API < 35** is a *supported* band where
`SystemBars` is a no-op.

The `@capawesome` plugin currently insets the WebView on **every** API/WebView
combination. Therefore **removing it without a replacement for the no-op band
regresses exactly the bug's device class** (Android 9 / API 28, `minSdkVersion 24`):
content slides under the bars and behind the keyboard, with zero inset
compensation. Note the app also force-enables edge-to-edge on API < 35 via
`@capacitor/status-bar`'s legacy `overlaysWebView: true` (see
`global-theme.service.ts:776–784`), so the OS will *not* fall back to insetting the
window for us there.

**Corollary for the keyboard bug:** moving to `SystemBars` only fixes the API<30
add-task-bar-behind-keyboard bug *if* the device has WebView ≥ 140. The reporter's
API 28 device may not. The native height workaround is pure geometry → reliable
regardless of WebView version. **Keep it.**

---

## Decision gates — do NOT start the spike until all hold

1. A **device/emulator matrix is actually runnable** for validation (it is not in
   the current Claude sandbox: gradle + emulator are unavailable, so any migration
   would land unvalidated on real devices — the precise failure mode of #8508).
2. A view on the **WebView-version distribution** of the Android user base (esp.
   API < 35), or an accepted decision to regress the WebView 107–139 / API<35 band.
3. **Design sign-off** on the end-state bar appearance: `SystemBars` has **no color
   API** (`setBackgroundColor()` = *Unsupported*, confirmed in
   `node_modules/@capacitor/core/system-bars.md`), so the end state is transparent
   bars with the web background showing through — a visible change from today's
   opaque `#131314` / `#f8f8f7` overlays, across light/dark, cutout, gesture vs
   3-button nav.
4. The reported keyboard bug is **already shipped** independently (PR #8528), so it
   does not ride on this risky rewrite.

---

## Corrected migration steps (each device-validated before merge)

1. **Spike on a fresh branch off master.** Keep the keyboard fix independent.

2. **Config (`capacitor.config.ts`):** remove the `EdgeToEdge` config block, drop
   `@capawesome/capacitor-android-edge-to-edge-support` from `android.includePlugins`
   and from `package.json`, then `npx cap sync` (regenerates
   `android/capacitor.settings.gradle` + `android/app/capacitor.build.gradle`; a
   stale module reference is a hard build break, so don't hand-edit).
   - Set `SystemBars.insetsHandling: 'css'`.
   - **KEEP `windowOptOutEdgeToEdgeEnforcement=true`** (`values-v35/styles.xml`).
     Removing it (the original plan's step 3) is **gratuitous extra risk**: on API
     35+ it turns `window.{status,navigation}BarColor` into hard no-ops (so even the
     custom `NavigationBarPlugin.setColor` stops coloring) and forces transparent
     bars — a separate behavioral change from the plugin swap. Do enforcement
     removal, if ever, as its own follow-up with design sign-off.
   - The `Keyboard.resizeOnFullScreen: false` comment ("required when paired with
     @capawesome edge-to-edge") becomes stale — fix the comment; the key is
     effectively iOS-only (Android excludes `@capacitor/keyboard`).

3. **Resolve the `--safe-area-inset-*` writer collision (HIGH).** `insetsHandling:
   'css'` injects `--safe-area-inset-{top,right,bottom,left}` onto
   `document.documentElement` — the **exact** vars the app already writes in
   `GlobalThemeService._initSafeAreaInsets()` and reads in `_css-variables.scss:51`.
   Two writers on the same inline style = last-writer-wins, OS/timing-dependent.
   Pick **one owner per platform**:
   - Android, API 35+ / WebView ≥ 140: let `SystemBars` own them → **stop the JS
     writes on Android**.
   - Android, the no-op band (WebView 107–139 / API<35): `SystemBars` injects
     nothing, so an `env()` fallback source is still required (the existing
     `var(--safe-area-inset-*, env(...))` chain in `_css-variables.scss` already
     provides it; the app's current Android top-deferral to `env(safe-area-inset-top)`
     for #8283 must be preserved).
   - Re-check `_patchCdkViewportForSafeArea()`: it `parseInt`s these vars via
     `getComputedStyle`. Today the top resolves to the literal `"env(...)"` string →
     `parseInt` yields 0 by design. Under `'css'`, `SystemBars` writes numeric px →
     overlay (menu/select/autocomplete) top positioning **changes** on Android.
     Re-test the full overlay matrix. Same for `task-context-menu` / `context-menu`
     readers of `--safe-area-inset-top`.

4. **Cover the no-op band (the hard problem).** Decide explicitly — do not leave
   implicit:
   - (a) Accept the regression for WebView 107–139 / API<35 (only if that
     population is negligible — needs data from gate #2). Simplest; risky.
   - (b) Keep a **minimal native inset shim** for that band (partially defeats the
     "drop the plugin" win, but bounded and self-owned).
   - (c) Turn `overlaysWebView` **off on Android < 15** so the OS insets the window
     normally there (opaque OS bars) — but this changes the look and re-enters #8283
     territory; verify the top-inset fallback.

5. **Bar color.** Transparent bars + paint behind them:
   `NavigationBarPlugin.setWebViewBackgroundColor` already sets the **window decor**
   (`window.setBackgroundDrawable`) *and* the WebView surface — independent of
   `@capawesome`, survives the migration, and is the lever for the color behind
   transparent bars. Combined with the web `<body>` background filling the
   safe-area zones and `SystemBars.setStyle` for light/dark icon content. Verify no
   white gap (the #8508 / capawesome-#725 failure) on every API/theme.

6. **Keyboard.** Keep `adjustWebViewHeightForKeyboardBelowApi30` (PR #8528) — it
   reads geometry only, so it is plugin-agnostic and WebView-version-independent.
   Its height target (`rect.bottom − webViewTopOnScreen`) is independent of the
   plugin, but `webViewTopOnScreen` shifts once the WebView is no longer natively
   inset → re-validate on API 28/29. Do **not** assume core #8481 retires it.

7. **`StartupOverlayManager.kt` (HIGH, native, not hotfixable).** It derives
   `webViewBottomInset` by *measuring the @capawesome-applied WebView margin*
   (lines 106–138). With the WebView no longer inset, that measures ~0 and the
   native startup quick-add bar drops behind the nav bar. Re-derive from system
   insets — but note the current code comment (lines 43–46) explicitly **rejected**
   `navigationBars()` because it mismatches the applied inset on gesture-nav
   devices; design the new source carefully. Update the now-wrong freeze-during-IME
   comment (lines 108–114).

8. **Keep for iOS:** `@capacitor/status-bar` (`StatusBar.setStyle` +
   `overlaysWebView` + `contentInset:'never'`) and `capacitor-plugin-safe-area`
   (the only iOS safe-area source). `SystemBars` `insetsHandling` is Android-only.
   Don't let a cleanup pass remove the `StatusBar` import from
   `global-theme.service.ts` (used on both platforms). Verify `SystemBars` does not
   double-write CSS vars on iOS.

---

## iOS invariants (must not break)

The migration is Android-only but `global-theme.service.ts` + `_css-variables.scss`
are shared. Keep: `StatusBar.overlaysWebView:true` + `ios.contentInset:'never'` +
`ios.backgroundColor` (content-under-notch on iOS), the iOS branch of
`_initSafeAreaInsets()` (`SafeArea.getSafeAreaInsets()` + `safeAreaChanged`), and
the iOS keyboard path in `_patchCdkViewportForSafeArea()`
(`--keyboard-overlay-offset`, gated on `body.isIOS`). Add iOS keyboard + notch +
overlays to the test matrix.

---

## Validation matrix (minimum, all UNVALIDATED in the dev sandbox)

- API 28/29 **split by WebView <140 vs ≥140**, API 30–34, API 35, API 36.
- Light + dark theme; gesture + 3-button nav; a device with a display cutout.
- Per cell: status/nav bar color (no white gap), content not under bars, add-task
  bar vs keyboard (open/close), native startup-overlay alignment, rotation,
  typed characters appear in order (the #8508 reversal check).
- iOS: notch, home indicator, keyboard, connected overlays.

---

## Multi-review findings to confirm on device (implementation, 2026-06-22)

A 3-agent review of the implementation diff found the merge resolution correct and
the migration mechanically clean (no leftovers, deps/gradle consistent, iOS
untouched). The residual risks are all device-matrix items — listed here so they
are explicitly checked, NOT blind-fixed (a blind fix risks re-creating #8508):

1. **API ≥ 35 + WebView < 140 double-count (narrow band).** In SystemBars'
   non-passthrough branch (API ≥ 35) it `setPadding`s the WebView parent *and*
   injects `--safe-area-inset-*`; if the web also pads via `var(--safe-area-*)`
   that double-counts. The common API 36 case is WebView ≥ 140 = passthrough (no
   static parent padding → no double-count), so this is the stale-WebView corner.
   Verify on an API 35/36 device with an old WebView; if real, gate the web
   padding off on that band rather than removing it globally.
2. **`env(safe-area-inset-bottom)` vs `var(--safe-area-bottom)` consumers diverge
   on API ≥ 35.** Some SCSS (e.g. `mobile-bottom-nav`, `app.component`) reads raw
   `env()`; others read `var(--safe-area-*)`. On API ≥ 35 SystemBars can zero the
   passed-through insets while injecting real px into the vars, so the two
   families disagree. Confirm the bottom-nav / add-task-bar spacing on API 35/36;
   reconcile to one source per band if it's wrong.
3. **API 30–34 + WebView < 140 IME owner.** The native shim is gated `SDK_INT < 30`
   (deliberate — newer APIs were observed to resize the window for the IME, and
   insetting on top of that re-creates the #8508 squash). Under SystemBars,
   WebView < 140 gets no IME padding below API 35. Verify whether the window still
   resizes on API 30–34: if it does, no gap; if it does NOT, extend the shim to
   `< 35 && WebView < 140` — but only after confirming on a device, never blind.
4. **CDK overlay / context-menu top position shifts on API ≥ 35.** `--safe-area-
   inset-top` now resolves to real px there (was 0 on Android), so connected
   overlays clamp below the status bar. Likely more correct; re-test the overlay
   matrix.

---

## Blast radius / rollback

- **Native (NOT remotely hotfixable):** plugin removal, `StartupOverlayManager.kt`,
  `NavigationBarPlugin.kt`, `styles.xml`. A wrong inset or white-bar regression
  needs a full Play Store release + staged rollout — the slow loop that made
  #8295/#8508 painful (the git log shows #8508 regressed, was "fixed", then
  reverted: `2a0cc73507` → `c247bc541a`).
- **Web (hotfixable):** the CSS-var/SCSS changes — but only if the symptom is
  genuinely web-side; many are coupled to the native inset model.
- **Rollback:** re-adding `@capawesome` is a multi-file native revert (re-pin dep,
  re-sync gradle, restore color calls + `StartupOverlayManager` coupling), not a
  one-line flip. Open a tracking issue and keep the revert documented.

---

## References

- Capacitor core: `ionic-team/capacitor#8466` (insetsHandling breaks WebView on
  API 29 + keyboard), fixed for built-in `SystemBars` by core PR **#8481** (merged).
- Plugin: `capawesome-team/capacitor-plugins` #845/#490/#596/#725/#819/#812,
  **#847 open**; plugin PR **#848** (open/unreleased; its "API 29 resizes via
  adjustResize" premise did not match this app's on-device logcat).
- App history: #8295, #8508 (`docs/android-edge-to-edge-keyboard.md`); the keyboard
  fix is PR **#8528**.
