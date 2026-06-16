# Android edge-to-edge + soft keyboard (IME)

Why the global add-task bar sits above the keyboard, and how the pieces fit.
Read this before touching anything keyboard/IME-related on Android — this area
has regressed twice.

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
`GlobalThemeService._initVisualViewportKeyboardTracking()` from
`obscured = window.innerHeight - visualViewport.height`. On iOS the Capacitor
Keyboard plugin sets it.

So the bar only floats above the keyboard if **either** the WebView shrinks
(then `bottom: 0` is already above the IME) **or** the visual viewport shrinks
(then `--keyboard-height` lifts the bar). If neither happens, the bar sits
behind the keyboard.

## The trap: targetSdk 35+ / edge-to-edge

On `targetSdkVersion >= 35` (we are on 36, Android 16) edge-to-edge is
**mandatory** and `android:windowSoftInputMode="adjustResize"` is a **no-op for
the IME** — the system no longer resizes the window when the keyboard opens.
`android:windowOptOutEdgeToEdgeEnforcement` only exists on API 35 (see
`res/values-v35/styles.xml`) and is ignored on API 36, so there is no opt-out.

Under enforced edge-to-edge the **only** thing that can shrink the WebView for
the IME is `@capawesome/capacitor-android-edge-to-edge-support`, which applies
the IME inset as the WebView's bottom margin via a single
`OnApplyWindowInsetsListener`.

## The plugin bug (fixed via patch-package)

`EdgeToEdge.applyInsetsInternal()` ships with:

```java
// When keyboard is visible, don't apply bottom margin to avoid double-counting
// (the system already resizes the window for the keyboard)
int bottomMargin = keyboardVisible ? 0 : Math.max(imeInsets.bottom, systemBarsInsets.bottom);
```

That comment's premise — _"the system already resizes the window"_ — is false on
Android 16. When the keyboard opens the plugin sets `bottomMargin = 0`, the
WebView stays full height, nothing resizes, and the fixed add-task bar ends up
behind the IME.

`patches/@capawesome+capacitor-android-edge-to-edge-support+8.0.8.patch` drops
the `keyboardVisible ? 0` special case:

```java
int bottomMargin = Math.max(imeInsets.bottom, systemBarsInsets.bottom);
```

`imeInsets.bottom` already spans the navigation-bar area while the keyboard is
up, and an edge-to-edge window never resizes for the IME, so a single `max()` is
correct in both states with no double-counting. With the WebView inset above the
keyboard, the content genuinely resizes and `--keyboard-height` stays `0` — the
bar lands at `bottom: var(--s2)` just above the IME, on the existing JS path with
no client changes.

Apply via `npm install` (runs `patch-package` in `postinstall`). Upstream this
to the plugin so the patch can be dropped.

## What NOT to do

Do not stack a second/third keyboard-height source on top of the VisualViewport
signal (native physical-px height + a `baseInnerHeight`-tracking path combined as
`max(obscured, nativeKeyboardHeight - layoutShrink)`). That was #8295; the
sources race on separate async events, the baseline gets reset to the shrunk
`innerHeight` mid-animation, the double-count guard collapses, and the bar is
mispositioned. It was reverted. Fix the inset at the source (the WebView size),
not with JS heuristics layered on top.

## Device test matrix (required before merging IME changes)

Heuristic stacking looks fine on one device and breaks on another — test the
add-task bar opening the keyboard, and content resizing, on:

- Android 10 (API 29) — pre-edge-to-edge; `Type.ime()` insets are unreliable here
- Android 14 (API 34) — edge-to-edge opt-out still possible
- Android 15 (API 35) — edge-to-edge enforced, `windowOptOutEdgeToEdgeEnforcement` honored
- Android 16 (API 36) — edge-to-edge mandatory, no opt-out (our target)

Both gesture-nav and 3-button-nav, light and dark.
