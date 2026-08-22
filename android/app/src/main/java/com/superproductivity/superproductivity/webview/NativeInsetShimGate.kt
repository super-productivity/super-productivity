package com.superproductivity.superproductivity.webview

/**
 * Decides whether our native inset shims in `CapacitorMainActivity` must run, or
 * whether Capacitor's built-in `SystemBars` already owns the insets.
 *
 * `SystemBars` installs an `OnApplyWindowInsetsListener` on the WebView's parent
 * (the activity content root) on **every** API level, so it — not the framework —
 * is the inset owner. But it only ever applies IME padding / real safe-area px on
 * two paths (`SystemBars.initWindowInsetsListener`):
 *
 * 1. the passthrough branch, gated `webViewMajor >= 140 && viewport-fit=cover`
 * 2. an `SDK_INT >= 35` branch
 *
 * Outside those two, it applies nothing at all — the keyboard and the status bar
 * are nobody's job. That intersection is what this gate names, so the shims run
 * exactly where `SystemBars` is absent and are a strict no-op everywhere it acts.
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
 * **Not quite the exact complement:** branch 1 also requires `viewport-fit=cover`,
 * which `SystemBars` only learns at `onDOMReady`. `src/index.html` sets it (keep it
 * there — dropping it strands WebView >= 140 / API < 35 devices with no inset
 * owner), so the only residual gap is the window before the first DOM ready, where
 * the IME cannot be up yet.
 */
object NativeInsetShimGate {
    /** `SystemBars` passthrough threshold — `WEBVIEW_VERSION_WITH_SAFE_AREA_FIX`. */
    const val WEBVIEW_VERSION_WITH_INSET_SUPPORT = 140

    /** `SystemBars` pads the WebView for the IME unconditionally from Android 15. */
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
     * So only an authoritative reading counts — `getCurrentWebViewPackage()`
     * ([WebViewCompatibilityChecker.Result.providerPackageIsCurrent]) or the
     * user-agent string, both of which describe the provider actually in use.
     * Anything else degrades to `null`, which runs the shim.
     */
    fun activeProviderMajor(result: WebViewCompatibilityChecker.Result?): Int? =
        result
            ?.takeIf {
                it.providerPackageIsCurrent ||
                    it.source == WebViewCompatibilityChecker.VersionSource.USER_AGENT
            }
            ?.majorVersion

    fun shouldRunShim(sdkInt: Int, webViewMajor: Int?): Boolean {
        if (sdkInt >= SDK_WITH_SYSTEM_BARS_IME_PADDING) return false
        // Unknown version -> run the shim. SystemBars reads the same provider and
        // treats an unreadable version as 0, so it skips its passthrough branch
        // too; leaving both off would strand the device with no inset owner.
        if (webViewMajor == null) return true
        return webViewMajor < WEBVIEW_VERSION_WITH_INSET_SUPPORT
    }
}
