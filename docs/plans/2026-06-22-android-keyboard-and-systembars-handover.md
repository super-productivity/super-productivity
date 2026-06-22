# Handover: Android API < 30 keyboard fix (PR #8528) + SystemBars migration

**Date:** 2026-06-22
**Branch:** `claude/android-task-bar-keyboard-overlap-jzd814` (PR #8528), worktree
`.worktrees/feat/pr-8528-c391fc`
**Author of handover:** prior session (Claude)

---

## TL;DR

- **Bug:** on Android 9 / **API 28** (the open device-class item #4 from #8508), the
  global add-task bar sits **behind the soft keyboard**.
- **Shipping fix (this PR, #8528):** a small **native workaround** in
  `CapacitorMainActivity` that gives the WebView an explicit layout **height** while
  the IME is up. Keyboard verified fixed on-device; one final visual check pending
  (no white navbar gap). **Recommend merging this as the fix.**
- **Migration (this handover's main ask):** move off the buggy
  `@capawesome/capacitor-android-edge-to-edge-support` plugin to Capacitor 8's
  **built-in `SystemBars`**. This is the right long-term direction but is a
  **re-architecture, not a drop-in** — do it as its **own PR**, not bundled with
  #8528. Detailed plan + gotchas below.

---

## 1. The shipping fix (PR #8528) — what's implemented now

**File:** `android/app/src/main/java/com/superproductivity/superproductivity/CapacitorMainActivity.kt`
**Method:** `adjustWebViewHeightForKeyboardBelowApi30(rect, isKeyboardOpen)`, called
from the existing keyboard `OnGlobalLayoutListener`. Field
`webViewLayoutHeightDefault` captures the resting height at startup.

How it works:
- API ≥ 30 → strict no-op (gate). The 18.12.0-verified path is untouched.
- Keyboard up → set explicit WebView `layout_height = rect.bottom − webViewTopOnScreen`
  (keyboard top, from `getWindowVisibleDisplayFrame`, reliable on API 28). Shrinks
  the web layout viewport so the existing CSS lifts the bar above the keyboard.
- Keyboard down → restore `webViewLayoutHeightDefault` (e.g. `MATCH_PARENT`).

Why height (not margin / padding / listener takeover) — see §3.

**Before merge:**
- [ ] Remove the debug `Log.d("SUPKeyboard", ...)` in `adjustWebViewHeightForKeyboardBelowApi30`.
- [ ] Re-title the PR `fix(android): ...` (currently `docs(android): ...`; squash subject matters).
- [ ] On-device: bar flush above keyboard, no flicker, **no white navbar gap**, and
      resting layout unchanged. Also sanity-check an API ≥ 30 device (no change).
- [ ] Doc updated: `docs/android-edge-to-edge-keyboard.md` (#8508 follow-up section).

---

## 2. Root cause (definitive, confirmed by on-device logcat)

The `@capawesome` edge-to-edge plugin (`EdgeToEdge.applyInsetsInternal`) sets the
WebView `bottomMargin = keyboardVisible ? 0 : max(imeInsets.bottom, navbar)`.
On this device `isVisible(ime())` returns **true**, so it zeroes the bottom margin
while the keyboard is up — *expecting the system to resize the window*. But under
enforced edge-to-edge (targetSdk 36, `windowOptOutEdgeToEdgeEnforcement` only opts
out the *enforcement*, the plugin still calls `setDecorFitsSystemWindows(false)`)
the window does **not** resize on API < 30, so the WebView keeps full height and the
`position: fixed` bar is behind the keyboard.

Logcat proof (API 28, screen 2400, keyboard top `rect.bottom=1533`): margin
alternated `0` (plugin) ↔ `867` (our correction) every frame — the flicker.

---

## 3. What was tried and FAILED (do not repeat)

1. **Margin, accumulate overlap** (`margin += delta`, clamp `keypadHeight`):
   flicker + over-lift (clamp = `navbar + keypadHeight`, a white gap).
2. **Margin, absolute target** (`margin = keypadHeight`, idempotent): still flickers
   — the plugin rewrites `bottomMargin=0` on every inset dispatch (two writers).
3. **WebView bottom padding**: WebView ignores View padding for the web layout
   viewport → bar stayed behind the keyboard.
4. **Replace the plugin's `OnApplyWindowInsetsListener`** (single-writer override):
   fixed the keyboard, but the plugin's `updateColorOverlays` then never ran → the
   status/nav **color overlays weren't painted → white navbar gap**.
5. **Explicit WebView height (CURRENT):** height is a different property than the
   margin the plugin manages, and for an explicit-height view the bottom margin does
   not change the view size → no fight, and the plugin keeps doing everything else
   (insets + color overlays). This is the shipping fix.

Key lesson: the plugin **owns `webView.bottomMargin`** and its color overlays are
coupled to its inset listener — don't fight either.

---

## 4. Upstream findings

- Plugin (`@capawesome/capacitor-android-edge-to-edge-support`) pinned **8.0.8**;
  Capacitor **^8.3.4**.
- Repeatedly-regressed area: `capawesome-team/capacitor-plugins` issues
  **#845** (API 29 collapse), #490, #596, #725 (the white gap), #819, #812; **#847
  open** (Android 15+).
- The maintainer redirects these to Capacitor core **`ionic-team/capacitor#8466`**
  ("insetsHandling 'disable' … breaks WebView on API 29 with keyboard"), **fixed for
  the built-in `SystemBars`** by core PR **#8481 (merged)**.
- Plugin PR **#848** ("correct WebView margin calculation") would fix the buggy
  ternary but is **open / unreleased**. Its premise ("API 29 resizes via
  adjustResize") did **not** match our logcat (no resize on API 28), so even #848
  may not fix our case. → our native workaround is independent and justified.

---

## 5. SystemBars migration plan (the main ask)

> **⚠️ Correction (added later):** Capacitor's built-in `SystemBars` effectively
> **no-ops below WebView 140 / API 35**, and this app supports **WebView 107+**. A
> naive `@capawesome` → `SystemBars` swap therefore **regresses API < 35 /
> WebView < 140** devices (the exact old-device class this whole bug is about). The
> migration must keep a fallback for that band (or stay on the plugin there). Treat
> §5c below as the *shape* of the work, gated behind this WebView/API check. See the
> corrected migration plan if present.

### 5a. Why it's NOT a drop-in
`SystemBars` (in `@capacitor/core` 8.3.4) exposes only `setStyle` (light/dark
content), `show`, `hide`, `setAnimation` — **no `setStatusBarColor` /
`setNavigationBarColor`**. The modern edge-to-edge model is **transparent system
bars with the web content drawn behind them**, padded via `env(safe-area-inset-*)`.
The app currently does the opposite on purpose: `@capawesome` paints opaque color
overlays behind the bars, and config sets `SystemBars.insetsHandling: 'disable'` +
`windowOptOutEdgeToEdgeEnforcement=true` so the plugin owns insets. Migrating
**reverses these deliberate choices**.

### 5b. Current edge-to-edge stack (all the moving parts)
- `capacitor.config.ts`: `SystemBars.insetsHandling: 'disable'`,
  `EdgeToEdge.{statusBarColor,navigationBarColor}: '#131314'`,
  `Keyboard.resizeOnFullScreen: false`, `StatusBar.overlaysWebView: true` (iOS),
  `android.includePlugins[...]` includes the `@capawesome` edge-to-edge plugin.
- `android/app/src/main/res/values-v35/styles.xml`:
  `android:windowOptOutEdgeToEdgeEnforcement = true`.
- `src/app/core/theme/global-theme.service.ts`:
  - `StatusBar.setStyle({ Dark|Light })`
  - `EdgeToEdge.setStatusBarColor / setNavigationBarColor` (theme bg) — **needs a
    replacement; SystemBars has none.**
  - app's **custom `NavigationBar` plugin** (`setColor` + `setSystemBarsAppearance`)
    — still drives nav-bar icon/pill appearance; may be the place to keep bar color.
  - `_initSafeAreaInsets()` + `_patchCdkViewportForSafeArea()` (via
    `capacitor-plugin-safe-area`) — becomes MORE important under transparent bars.
- `CapacitorMainActivity.kt`: keyboard JS-interface + the new height workaround;
  references `bridge.webView`.
- `StartupOverlayManager.kt`: reads the plugin-applied WebView bottom inset
  (`webViewBottomInset`) from WebView geometry to align the native startup overlay —
  **coupled to the plugin's insets; will need rework.**

### 5c. Migration steps (suggested order, each device-validated)
1. **Spike on a fresh branch** off master (not on #8528). Keep #8528's keyboard fix
   independent.
2. **Config:** remove `EdgeToEdge` plugin config; drop the plugin from
   `android.includePlugins`; remove the dep from `package.json`; `npx cap sync`.
   Decide `SystemBars.insetsHandling`: `'css'` (expose `env(safe-area-inset-*)`,
   web pads itself) is the likely target — verify the core #8481 behavior.
3. **Enforcement:** reconsider `windowOptOutEdgeToEdgeEnforcement` (likely remove so
   Android 15+ enforces edge-to-edge natively; verify status-bar/cutout layout).
4. **Colors:** replace `EdgeToEdge.set*BarColor` with either (a) transparent bars +
   web background showing through (preferred, true edge-to-edge), or (b) the app's
   custom `NavigationBar` plugin for the nav bar + `SystemBars.setStyle` for content
   style. Status-bar color under edge-to-edge = the web content behind it.
5. **Safe-area:** ensure `_initSafeAreaInsets` / CDK patch cover all surfaces now
   that content draws behind the bars (bottom nav, add-task bar, dialogs, menus).
6. **Keyboard:** re-test API < 30. With `insetsHandling` core-handled (#8481) the
   bar-behind-keyboard bug may be resolved by core; if not, keep the
   `adjustWebViewHeightForKeyboardBelowApi30` workaround (it's plugin-agnostic — it
   only reads geometry — so it should still work).
7. **StartupOverlayManager:** re-derive its inset from the new model (system insets
   instead of the plugin's applied WebView margin).
8. Remove now-dead pieces (the `EdgeToEdge` import in `global-theme.service.ts`, etc.).

### 5d. Risks / gotchas
- **Highest risk:** this re-touches edge-to-edge across **all** API levels and
  themes — the exact area that silently regressed at #8295 and twice at #8508.
- No color API → **status/nav bar appearance changes** (transparent vs opaque). Get
  design sign-off; check light + dark themes, notch/cutout, gesture vs 3-button nav.
- `capacitor-plugin-safe-area` + the CDK overlay patch must cover every floating
  surface or content slides under the bars.
- iOS path (`StatusBar.overlaysWebView`, `ios.contentInset/backgroundColor`) is
  separate — verify the migration doesn't disturb it.

### 5e. Validation matrix (minimum)
API 28/29 (no edge-to-edge resize), API 30–34, API 35+ (enforced edge-to-edge);
light + dark theme; gesture + 3-button nav; device with a display cutout; keyboard
open/close on each; rotation. Watch: bar colors, content behind bars, add-task bar
vs keyboard, startup overlay alignment.

---

## 6. Recommendation / sequencing

1. **Merge #8528** (height workaround) to fix the user's reported bug now — low
   risk, scoped to API < 30, plugin untouched.
2. **Then** do the SystemBars migration as its own spike → PR, using §5. Treat it as
   a deliberate edge-to-edge re-architecture with full device-matrix validation, not
   a quick swap. Link the PR to `ionic-team/capacitor#8466`, core #8481, plugin #848.
3. Open a tracking issue: "Migrate Android edge-to-edge from @capawesome plugin to
   Capacitor built-in SystemBars" referencing this handover.

---

## Key files
- `android/app/src/main/java/com/superproductivity/superproductivity/CapacitorMainActivity.kt` (keyboard workaround)
- `android/app/src/main/java/com/superproductivity/superproductivity/widget/StartupOverlayManager.kt` (inset coupling)
- `src/app/core/theme/global-theme.service.ts` (EdgeToEdge color calls, safe-area, NavigationBar)
- `capacitor.config.ts` (plugin config, insetsHandling, includePlugins)
- `android/app/src/main/res/values-v35/styles.xml` (edge-to-edge opt-out)
- `docs/android-edge-to-edge-keyboard.md` (full history + current fix)
- Plugin source (reference): `node_modules/@capawesome/capacitor-android-edge-to-edge-support/android/src/main/java/io/capawesome/capacitorjs/plugins/androidedgetoedgesupport/EdgeToEdge.java`
