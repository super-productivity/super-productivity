package com.superproductivity.superproductivity.webview

/**
 * Decides whether our native inset shims in `CapacitorMainActivity` must run, or
 * whether Capacitor's built-in `SystemBars` already owns the insets.
 *
 * **Contract as of Capacitor 8.5.2+ (see docs/android-edge-to-edge-keyboard.md,
 * "Capacitor 8.5.2+").** `SystemBars` installs its `OnApplyWindowInsetsListener`
 * on the window's **DecorView** and takes one of two branches on every API level
 * (`SystemBars.initWindowInsetsListener`):
 *
 * 1. passthrough, gated `webViewMajor >= 140 && viewport-fit=cover` — pads the
 *    DecorView for the IME only and lets the WebView read the real insets;
 * 2. otherwise — pads the DecorView for the system bars **and** the IME.
 *
 * So the band this gate names (API < 35 and WebView < 140) is now padded by
 * branch 2 as well: the WebView already ends at the keyboard top and below the
 * status bar. The shims still run there, but both are absolute, resize-detecting
 * measurements, so they land where the WebView already is and change nothing —
 * measured on the API 34 / WebView 113 CI emulator (2026-10, Actions run
 * 38892553227, `SUPOverlayTest` logcat): SystemBars padded
 * the DecorView `0,24,0,0` at rest and `0,24,0,235` with the IME up (640 px root,
 * keyboard top at 405), so the WebView already spanned 24..405 when the shim wrote
 * its 381 px height.
 * They are kept, not removed, because nothing in the field has confirmed branch 2
 * on a real device in the band yet, and because they are what covers it again if
 * Capacitor is ever pinned back to <= 8.5.1. Remove them in a follow-up once
 * device reports from the band (#9316 reporters, API 28-34 custom ROMs) agree.
 *
 * **Up to Capacitor 8.5.1** (what this gate was written for) the listener sat on
 * the WebView's parent and branch 2 only padded on `SDK_INT >= 35`; below that
 * the keyboard and the status bar were nobody's job, which is the gap this gate
 * names. The rest of this comment explains why it is drawn exactly there.
 *
 * Why nothing else catches it: the app runs the WebView under
 * `SYSTEM_UI_FLAG_LAYOUT_STABLE or SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN` (Capacitor's
 * StatusBar plugin, `overlaysWebView: true` in `capacitor.config.ts`), and under
 * layout-fullscreen the manifest's `adjustResize` does **not** shrink the window
 * for the IME. So on API < 35 the framework never resizes anything either — which
 * is why this is a WebView-version problem, not the SDK-version problem the
 * original gate assumed.
 *
 * Widened from the original `SDK_INT < 30` gate for #9316: two users on **API 34
 * with WebView 124 / 126** had the add-task bar sit behind the keyboard, and one
 * of them confirmed the fix by side-loading WebView 151 with no app change. The
 * old gate assumed API >= 30 implies a current WebView because it auto-updates —
 * false on a custom ROM that ships its own `com.android.webview` and disables the
 * Play-updated Google package.
 *
 * **Not quite the exact complement:** branch 1 also requires `viewport-fit=cover`.
 * `SystemBars` reads it back from the page at `onPageCommitVisible`, and
 * `capacitor.config.ts` seeds it with `initialViewportFitValueHint: 'cover'` so
 * WebView >= 140 is in branch 1 from the first inset pass. `src/index.html` sets
 * the tag (keep the two in step).
 */
object NativeInsetShimGate {
    /** `SystemBars` passthrough threshold — `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX`. */
    const val WEBVIEW_VERSION_WITH_INSET_SUPPORT = 140

    /**
     * Up to Capacitor 8.5.1, `SystemBars` padded for the IME outside passthrough
     * only from Android 15. From 8.5.2 it pads on every API level (see above).
     */
    const val SDK_WITH_SYSTEM_BARS_IME_PADDING = 35

    /**
     * The version to gate on: the **active** provider's major version, or `null`
     * when we do not know what is actually rendering.
     *
     * `SystemBars` reads only `WebView.getCurrentWebViewPackage()` and treats a
     * failed read as `0`, so the gate must agree with *that* or the two can
     * disagree about who owns the insets. [WebViewCompatibilityChecker] answers a
     * different question (may we block the app?) and therefore falls back to
     * scanning installed packages — which on a custom ROM can report an
     * installed-but-**disabled** provider. That is exactly the #9316 layout, where
     * the scan finds `com.google.android.webview` 150 while the active provider is
     * `com.android.webview` 124: feeding the gate 150 would switch the shim off on
     * the one device it exists for, with `SystemBars` (seeing 0) off as well.
     *
     * So only a `getCurrentWebViewPackage()` reading counts
     * ([WebViewCompatibilityChecker.Result.providerPackageIsCurrent]). The
     * user-agent string also describes the active provider, but the checker only
     * falls back to it when `getCurrentWebViewPackage()` failed — precisely the
     * case where `SystemBars` reads 0 and is off — so trusting a UA major >= 140
     * there would switch the shim off as well and leave the device with no inset
     * owner: the #9316 symptom on a perfectly current WebView. Anything but the
     * current-package reading degrades to `null`, which runs the shim.
     *
     * KNOWN GAP (unobserved, so deliberately not guarded): "the current-package
     * reading" is the package, not necessarily its `versionName`. `evaluate()`
     * falls back to `parseMajorVersion(longVersionCode)` — the first three
     * digits of the version code — when `versionName` does not parse, and that
     * number can read >= 140 for an older WebView (124 -> 624). `SystemBars`
     * reads `versionName` and would see 0 there, so the two would disagree and
     * leave no inset owner. No device with an unparseable WebView `versionName`
     * has been reported; if one ever is, make this require a `versionName`-
     * derived major rather than widening the fallback.
     */
    fun activeProviderMajor(result: WebViewCompatibilityChecker.Result?): Int? =
        result?.takeIf { it.providerPackageIsCurrent }?.majorVersion

    fun shouldRunShim(sdkInt: Int, webViewMajor: Int?): Boolean {
        if (sdkInt >= SDK_WITH_SYSTEM_BARS_IME_PADDING) return false
        // Unknown version -> run the shim. SystemBars reads the same provider and
        // treats an unreadable version as 0, so it skips its passthrough branch
        // too; leaving both off would strand the device with no inset owner.
        if (webViewMajor == null) return true
        return webViewMajor < WEBVIEW_VERSION_WITH_INSET_SUPPORT
    }
}
