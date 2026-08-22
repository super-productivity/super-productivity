package com.superproductivity.superproductivity.webview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImeWebViewHeightTest {

    @Test
    fun `computes the height already in effect where the window resized itself`() {
        // The #8508 invariant, and the reason widening the gate is safe: on a
        // device that already shrank for the IME the WebView bottom is at
        // rectBottom, so the target equals the current height. The caller's
        // `params.height == targetHeight` check then writes nothing — no second
        // inset stacked on the system's own, which is what squashed the WebView
        // in #8508. A delta-based target would fail this test.
        val webViewTop = 100
        val rectBottom = 1800
        val currentHeight = rectBottom - webViewTop

        assertEquals(
            currentHeight,
            ImeWebViewHeight.targetHeight(rectBottom = rectBottom, webViewTop = webViewTop)
        )
    }

    @Test
    fun `shrinks to the keyboard top where the window did not resize`() {
        // #9316: window stays full height (layout-fullscreen suppresses
        // adjustResize), the visible frame stops at the keyboard, so the WebView
        // must be pinned to that.
        assertEquals(1100, ImeWebViewHeight.targetHeight(rectBottom = 1200, webViewTop = 100))
    }

    @Test
    fun `stays idempotent when applied repeatedly`() {
        // The listener fires on every layout pass; feeding the result back must
        // not drift, or the shim would walk the WebView shut over a few passes.
        val first = ImeWebViewHeight.targetHeight(rectBottom = 1200, webViewTop = 100)
        val second = ImeWebViewHeight.targetHeight(rectBottom = 1200, webViewTop = 100)
        assertEquals(first, second)
    }

    @Test
    fun `refuses a degenerate frame instead of collapsing the WebView`() {
        // Transient/pre-layout geometry. Returning 0 or a negative height would
        // latch (the caller stops recomputing once the WebView measures 0), so
        // the current height must be kept instead.
        assertNull(ImeWebViewHeight.targetHeight(rectBottom = 100, webViewTop = 100))
        assertNull(ImeWebViewHeight.targetHeight(rectBottom = 50, webViewTop = 100))
        assertNull(ImeWebViewHeight.targetHeight(rectBottom = 0, webViewTop = 0))
    }
}
