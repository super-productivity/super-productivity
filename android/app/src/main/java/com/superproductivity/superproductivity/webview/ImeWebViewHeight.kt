package com.superproductivity.superproductivity.webview

/**
 * The WebView layout height that keeps the web content above the soft keyboard,
 * for `CapacitorMainActivity.adjustWebViewHeightForKeyboard`.
 *
 * Split out from the activity for one reason: this arithmetic *is* the argument
 * that widening [NativeInsetShimGate] cannot re-create #8508, and that argument
 * deserves a test rather than a comment. The target is **absolute** — the visible
 * frame's bottom minus where the WebView starts — never a delta applied to the
 * current height. So on a device whose window already shrank for the IME, the
 * WebView bottom is already at `rectBottom` and this returns the height already
 * in effect: the caller compares, sees no change, and writes nothing. A
 * delta-based inset is what squashed the WebView in #8508; do not reintroduce
 * one here.
 */
object ImeWebViewHeight {
    /**
     * @param rectBottom bottom of `getWindowVisibleDisplayFrame` — the keyboard's
     *   top edge while the IME is up, in physical px.
     * @param webViewTop the WebView's top on screen (`getLocationOnScreen`).
     * @return the height to apply, or `null` for a degenerate/transient frame
     *   that would collapse the WebView — the caller must then leave the current
     *   height alone rather than latch a bad value.
     */
    fun targetHeight(rectBottom: Int, webViewTop: Int): Int? =
        (rectBottom - webViewTop).takeIf { it > 0 }
}
