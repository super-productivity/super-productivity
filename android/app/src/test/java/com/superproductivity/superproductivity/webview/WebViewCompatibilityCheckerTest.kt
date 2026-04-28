package com.superproductivity.superproductivity.webview

import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker.Status
import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewCompatibilityCheckerTest {
    @Test
    fun `blocks old authoritative WebView version`() {
        assertEquals(
            Status.BLOCK,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION - 1,
                packageName = "com.google.android.webview",
                canBlockBasedOnVersion = true,
            ),
        )
    }

    @Test
    fun `warns for old package-manager fallback version`() {
        assertEquals(
            Status.WARN,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION - 1,
                packageName = "com.google.android.webview",
                canBlockBasedOnVersion = false,
            ),
        )
    }

    @Test
    fun `accepts recommended package-manager fallback version`() {
        assertEquals(
            Status.OK,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = WebViewCompatibilityChecker.RECOMMENDED_CHROMIUM_VERSION,
                packageName = "com.google.android.webview",
                canBlockBasedOnVersion = false,
            ),
        )
    }
}
