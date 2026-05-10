package com.superproductivity.superproductivity.webview

import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker.Status
import org.junit.Assert.assertEquals
import org.junit.Test

class WebViewCompatibilityCheckerTest {

    // statusForVersion -------------------------------------------------------

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
    fun `blocks when user agent reports old version with no provider package`() {
        // Regression guard: USER_AGENT source has packageName=null, but is still
        // authoritative. Must still block when below MIN.
        assertEquals(
            Status.BLOCK,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION - 1,
                packageName = null,
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

    @Test
    fun `warns when major version is unknown`() {
        assertEquals(
            Status.WARN,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = null,
                packageName = "com.google.android.webview",
                canBlockBasedOnVersion = true,
            ),
        )
    }

    @Test
    fun `warns for third-party WebView with very low version even when authoritative`() {
        // Third-party WebViews sometimes use non-Chromium versioning. We only warn,
        // never block, when their reported major is suspiciously small.
        assertEquals(
            Status.WARN,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = 30,
                packageName = "com.example.someotherwebview",
                canBlockBasedOnVersion = true,
            ),
        )
    }

    @Test
    fun `accepts recommended authoritative version`() {
        assertEquals(
            Status.OK,
            WebViewCompatibilityChecker.statusForVersion(
                majorVersion = WebViewCompatibilityChecker.RECOMMENDED_CHROMIUM_VERSION,
                packageName = "com.google.android.webview",
                canBlockBasedOnVersion = true,
            ),
        )
    }

    // applyOverrides ---------------------------------------------------------

    @Test
    fun `applyOverrides downgrades BLOCK when user override is set`() {
        assertEquals(
            Status.WARN,
            WebViewCompatibilityChecker.applyOverrides(
                rawStatus = Status.BLOCK,
                lastKnownGoodVersion = null,
                userOverride = true,
            ),
        )
    }

    @Test
    fun `applyOverrides downgrades BLOCK when last known good version is acceptable`() {
        assertEquals(
            Status.WARN,
            WebViewCompatibilityChecker.applyOverrides(
                rawStatus = Status.BLOCK,
                lastKnownGoodVersion = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION,
                userOverride = false,
            ),
        )
    }

    @Test
    fun `applyOverrides keeps BLOCK when no override and no good history`() {
        assertEquals(
            Status.BLOCK,
            WebViewCompatibilityChecker.applyOverrides(
                rawStatus = Status.BLOCK,
                lastKnownGoodVersion = null,
                userOverride = false,
            ),
        )
    }

    @Test
    fun `applyOverrides keeps BLOCK when last good version is itself old`() {
        assertEquals(
            Status.BLOCK,
            WebViewCompatibilityChecker.applyOverrides(
                rawStatus = Status.BLOCK,
                lastKnownGoodVersion = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION - 1,
                userOverride = false,
            ),
        )
    }

    @Test
    fun `applyOverrides leaves non-BLOCK status untouched`() {
        assertEquals(
            Status.OK,
            WebViewCompatibilityChecker.applyOverrides(
                rawStatus = Status.OK,
                lastKnownGoodVersion = null,
                userOverride = true,
            ),
        )
        assertEquals(
            Status.WARN,
            WebViewCompatibilityChecker.applyOverrides(
                rawStatus = Status.WARN,
                lastKnownGoodVersion = null,
                userOverride = true,
            ),
        )
    }

    // parseMajorVersion ------------------------------------------------------

    @Test
    fun `parseMajorVersion ignores zero and negative version codes`() {
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion(0))
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion(-1))
    }

    @Test
    fun `parseMajorVersion returns null for null or blank versionName`() {
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion(null as String?))
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion(""))
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion("   "))
    }

    @Test
    fun `parseMajorVersion parses a bare major number`() {
        assertEquals(147, WebViewCompatibilityChecker.parseMajorVersion("147"))
    }

    @Test
    fun `parseMajorVersion parses standard chrome dotted versionName`() {
        assertEquals(147, WebViewCompatibilityChecker.parseMajorVersion("147.0.7390.131"))
    }

    @Test
    fun `parseMajorVersion stops at non-digit non-dot suffix`() {
        // Some OEM builds append channel/build suffixes like "-arm64" or " (stable)".
        assertEquals(147, WebViewCompatibilityChecker.parseMajorVersion("147.0.7390.131-arm64"))
        assertEquals(147, WebViewCompatibilityChecker.parseMajorVersion("147.0 stable"))
    }

    @Test
    fun `parseMajorVersion returns null when versionName starts with a non-digit`() {
        // Documents current behaviour: a leading letter (e.g. "M147" milestone prefix
        // some Chromium builds historically used) yields null and forces the caller
        // into the longVersionCode fallback.
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion("M147.0"))
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion(" 147.0"))
    }

    @Test
    fun `parseMajorVersion returns null for non-numeric versionName`() {
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion("unknown"))
        assertEquals(null, WebViewCompatibilityChecker.parseMajorVersion("..."))
    }

    @Test
    fun `parseMajorVersion returns zero for explicit 0 versionName`() {
        // "0" is technically parseable; statusForVersion still treats it as old → BLOCK.
        // This guards against silently returning null and skipping to versionCode.
        assertEquals(0, WebViewCompatibilityChecker.parseMajorVersion("0"))
    }
}
