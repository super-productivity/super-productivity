package com.superproductivity.superproductivity.webview

import com.superproductivity.superproductivity.R
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker.BlockScreenAction
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker.Status
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker.VersionSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    // source handling --------------------------------------------------------

    @Test
    fun `sourceFromName parses known source names`() {
        assertEquals(
            VersionSource.INIT_FAILURE,
            WebViewCompatibilityChecker.sourceFromName("INIT_FAILURE"),
        )
        assertEquals(
            VersionSource.USER_AGENT,
            WebViewCompatibilityChecker.sourceFromName("USER_AGENT"),
        )
    }

    @Test
    fun `sourceFromName falls back to UNKNOWN for missing or invalid source names`() {
        assertEquals(VersionSource.UNKNOWN, WebViewCompatibilityChecker.sourceFromName(null))
        assertEquals(VersionSource.UNKNOWN, WebViewCompatibilityChecker.sourceFromName(""))
        assertEquals(VersionSource.UNKNOWN, WebViewCompatibilityChecker.sourceFromName("not-a-source"))
    }

    @Test
    fun `canBypassBlock only disables override for WebView init failures`() {
        assertEquals(false, WebViewCompatibilityChecker.canBypassBlock(VersionSource.INIT_FAILURE))
        assertEquals(true, WebViewCompatibilityChecker.canBypassBlock(VersionSource.USER_AGENT))
        assertEquals(true, WebViewCompatibilityChecker.canBypassBlock(VersionSource.PACKAGE))
        assertEquals(true, WebViewCompatibilityChecker.canBypassBlock(VersionSource.UNKNOWN))
    }

    @Test
    fun `shouldPreferCurrentProviderPackage trusts healthy current provider over stale user agent`() {
        assertTrue(
            WebViewCompatibilityChecker.shouldPreferCurrentProviderPackage(
                packageMajor = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION,
                providerPackageIsCurrent = true,
            ),
        )
    }

    @Test
    fun `shouldPreferCurrentProviderPackage keeps user agent path for fallback or old provider package`() {
        assertFalse(
            WebViewCompatibilityChecker.shouldPreferCurrentProviderPackage(
                packageMajor = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION,
                providerPackageIsCurrent = false,
            ),
        )
        assertFalse(
            WebViewCompatibilityChecker.shouldPreferCurrentProviderPackage(
                packageMajor = WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION - 1,
                providerPackageIsCurrent = true,
            ),
        )
        assertFalse(
            WebViewCompatibilityChecker.shouldPreferCurrentProviderPackage(
                packageMajor = null,
                providerPackageIsCurrent = true,
            ),
        )
    }

    @Test
    fun `knownWebViewPackages includes Vanadium System WebView`() {
        assertTrue(WebViewCompatibilityChecker.knownWebViewPackages().contains("app.vanadium.webview"))
    }

    @Test
    fun `blockScreenConfig uses init-failure copy and gated app-info action when provider details exist`() {
        val config = WebViewCompatibilityChecker.blockScreenConfig(
            source = VersionSource.INIT_FAILURE,
            hasProviderDetails = true,
        )

        assertEquals(R.string.webview_init_failure_message, config.titleResId)
        assertEquals(R.string.webview_init_failure_details_with_provider, config.detailsIntroResId)
        assertEquals(BlockScreenAction.OPEN_WEBVIEW_APP_INFO_WITH_WARNING, config.action)
        assertFalse(config.showTryAnyway)
        assertTrue(config.showSource)
        assertTrue(config.showRetry)
    }

    @Test
    fun `blockScreenConfig avoids provider claim when init failure has no provider details`() {
        val config = WebViewCompatibilityChecker.blockScreenConfig(
            source = VersionSource.INIT_FAILURE,
            hasProviderDetails = false,
        )

        assertEquals(R.string.webview_init_failure_details_without_provider, config.detailsIntroResId)
        assertFalse(config.showTryAnyway)
        assertTrue(config.showRetry)
    }

    @Test
    fun `blockScreenConfig keeps version blocks bypassable and hides unknown source`() {
        val config = WebViewCompatibilityChecker.blockScreenConfig(
            source = VersionSource.UNKNOWN,
            hasProviderDetails = false,
        )

        assertEquals(R.string.webview_block_message, config.titleResId)
        assertEquals(null, config.detailsIntroResId)
        assertEquals(BlockScreenAction.UPDATE_WEBVIEW, config.action)
        assertTrue(config.showTryAnyway)
        assertFalse(config.showSource)
        assertFalse(config.showRetry)
    }

    // initFailureResult ------------------------------------------------------

    @Test
    fun `initFailureResult drops the version carried over from the pre-flight check`() {
        // Regression guard for #7229/#7518: the pre-flight version often comes from the
        // PackageManager fallback (a disabled or never-updated package that is not the
        // active provider). Rendering it made the block screen claim an outdated WebView
        // on healthy devices, and users responded by removing their WebView updates.
        val result = WebViewCompatibilityChecker.initFailureResult(
            WebViewCompatibilityChecker.Result(
                status = Status.WARN,
                majorVersion = 99,
                providerPackage = "com.google.android.webview",
                providerVersionName = "99.0.4844.88",
                source = VersionSource.PACKAGE,
            ),
        )

        assertEquals(null, result.majorVersion)
        assertEquals(null, result.providerVersionName)
        assertEquals(Status.BLOCK, result.status)
        assertEquals(VersionSource.INIT_FAILURE, result.source)
    }

    @Test
    fun `initFailureResult keeps the provider package but drops its provenance`() {
        // The package survives because it aims the "open WebView app settings" intent —
        // dropping it would send that button at a package that may not be installed.
        // providerPackageIsCurrent must NOT survive: it is a pre-flight claim about the
        // version, and nothing on the init-failure screen may assert one.
        val result = WebViewCompatibilityChecker.initFailureResult(
            WebViewCompatibilityChecker.Result(
                status = Status.OK,
                majorVersion = 147,
                providerPackage = "app.vanadium.webview",
                providerVersionName = "147.0.7727.55",
                source = VersionSource.PACKAGE,
                providerPackageIsCurrent = true,
            ),
        )

        assertEquals("app.vanadium.webview", result.providerPackage)
        assertFalse(result.providerPackageIsCurrent)
        // Still no version claim, even though this one was authoritative.
        assertEquals(null, result.majorVersion)
        assertEquals(null, result.providerVersionName)
    }

    @Test
    fun `initFailureResult blocks with no provider details when evaluation itself failed`() {
        val result = WebViewCompatibilityChecker.initFailureResult(null)

        assertEquals(Status.BLOCK, result.status)
        assertEquals(VersionSource.INIT_FAILURE, result.source)
        assertEquals(null, result.majorVersion)
        assertEquals(null, result.providerPackage)
        assertEquals(null, result.providerVersionName)
        assertFalse(result.providerPackageIsCurrent)
    }

    @Test
    fun `initFailureResult stays terminal for a WebView that passed the version check`() {
        // A healthy pre-flight status must not leak through: it would flip the screen
        // out of BLOCK. (canBypassBlock(INIT_FAILURE) is covered separately above.)
        val result = WebViewCompatibilityChecker.initFailureResult(
            WebViewCompatibilityChecker.Result(
                status = Status.OK,
                majorVersion = WebViewCompatibilityChecker.RECOMMENDED_CHROMIUM_VERSION,
                providerPackage = "com.google.android.webview",
                providerVersionName = "147.0.7727.55",
                source = VersionSource.USER_AGENT,
            ),
        )

        assertTrue(result.isBlocked)
    }

    // Intent helper data ------------------------------------------------------

    @Test
    fun `webViewUpdatePageUrl uses current provider package when available`() {
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.android.chrome",
            WebViewCompatibilityChecker.webViewUpdatePageUrl("com.android.chrome"),
        )
    }

    @Test
    fun `webViewUpdatePageUrl falls back to Android System WebView package`() {
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.google.android.webview",
            WebViewCompatibilityChecker.webViewUpdatePageUrl(null),
        )
        assertEquals(
            "https://play.google.com/store/apps/details?id=com.google.android.webview",
            WebViewCompatibilityChecker.webViewUpdatePageUrl(""),
        )
    }

    @Test
    fun `webViewProviderDetailsUri targets provider app details`() {
        assertEquals(
            "package:com.android.chrome",
            WebViewCompatibilityChecker.webViewProviderDetailsUri("com.android.chrome"),
        )
    }

    @Test
    fun `providerPackageOrDefault keeps a resolved provider but falls back when blank`() {
        assertEquals(
            "com.android.chrome",
            WebViewCompatibilityChecker.providerPackageOrDefault("com.android.chrome"),
        )
        // Init failures usually have no resolvable provider, so App Info must still
        // target the standard system WebView package rather than "package:null".
        assertEquals(
            "com.google.android.webview",
            WebViewCompatibilityChecker.providerPackageOrDefault(null),
        )
        assertEquals(
            "com.google.android.webview",
            WebViewCompatibilityChecker.providerPackageOrDefault("  "),
        )
    }

    // WebView init failure classification ------------------------------------

    @Test
    fun `isLikelyWebViewInitFailure detects WebView stack frames`() {
        val error = RuntimeException("Factory failed").apply {
            stackTrace = arrayOf(
                StackTraceElement("android.webkit.WebViewFactory", "getProvider", "WebViewFactory.java", 1),
            )
        }

        assertTrue(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    @Test
    fun `isLikelyWebViewInitFailure detects WebView native library load errors`() {
        assertTrue(
            WebViewCompatibilityChecker.isLikelyWebViewInitFailure(
                UnsatisfiedLinkError("dlopen failed: libwebviewchromium.so missing"),
            ),
        )
    }

    @Test
    fun `isLikelyWebViewInitFailure detects missing WebView package failures`() {
        assertTrue(
            WebViewCompatibilityChecker.isLikelyWebViewInitFailure(
                RuntimeException("android.webkit.WebViewFactory\$MissingWebViewPackageException"),
            ),
        )
    }

    @Test
    fun `isLikelyWebViewInitFailure rejects unrelated runtime failures`() {
        val error = IllegalStateException("Plugin config file missing").apply {
            stackTrace = arrayOf(
                StackTraceElement("com.getcapacitor.PluginManager", "load", "PluginManager.java", 1),
            )
        }

        assertFalse(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    @Test
    fun `isLikelyWebViewInitFailure rejects unrelated message-only WebView references`() {
        val error = IllegalStateException("loadWebView failed while reading plugin config").apply {
            stackTrace = arrayOf(
                StackTraceElement("com.getcapacitor.PluginManager", "load", "PluginManager.java", 1),
            )
        }

        assertFalse(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    @Test
    fun `isLikelyWebViewInitFailure rejects Capacitor loadWebView frames`() {
        val error = IllegalStateException("Plugin config file missing").apply {
            stackTrace = arrayOf(
                StackTraceElement("com.getcapacitor.Bridge", "loadWebView", "Bridge.java", 1),
            )
        }

        assertFalse(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    @Test
    fun `isLikelyWebViewInitFailure rejects app webview package frames`() {
        val error = IllegalStateException("App WebView setup failed").apply {
            stackTrace = arrayOf(
                StackTraceElement(
                    "com.superproductivity.superproductivity.webview.WebHelper",
                    "setupView",
                    "WebHelper.kt",
                    1,
                ),
            )
        }

        assertFalse(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    @Test
    fun `isLikelyWebViewInitFailure rejects fatal VM errors even with WebView frames`() {
        val error = OutOfMemoryError("out of memory").apply {
            stackTrace = arrayOf(
                StackTraceElement("android.webkit.WebViewFactory", "getProvider", "WebViewFactory.java", 1),
            )
        }

        assertFalse(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    @Test
    fun `isLikelyWebViewInitFailure rejects wrapped fatal VM errors`() {
        val cause = StackOverflowError("stack overflow").apply {
            stackTrace = arrayOf(
                StackTraceElement("android.webkit.WebViewFactory", "getProvider", "WebViewFactory.java", 1),
            )
        }
        val error = RuntimeException("WebView factory failed", cause)

        assertFalse(WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error))
    }

    // init-failure recovery guard --------------------------------------------

    @Test
    fun `shouldRetryInitFailure allows the first recovery attempt`() {
        assertTrue(
            WebViewCompatibilityChecker.shouldRetryInitFailure(
                lastRetryAt = 0L,
                now = 1_000L,
                windowMs = 60_000L,
            ),
        )
    }

    @Test
    fun `shouldRetryInitFailure blocks a second attempt within the window`() {
        // The relaunch we just triggered failed again immediately → don't boot-loop.
        assertFalse(
            WebViewCompatibilityChecker.shouldRetryInitFailure(
                lastRetryAt = 1_000L,
                now = 1_000L + 59_000L,
                windowMs = 60_000L,
            ),
        )
    }

    @Test
    fun `shouldRetryInitFailure allows a fresh attempt once the window elapses`() {
        assertTrue(
            WebViewCompatibilityChecker.shouldRetryInitFailure(
                lastRetryAt = 1_000L,
                now = 1_000L + 60_000L,
                windowMs = 60_000L,
            ),
        )
    }

    @Test
    fun `shouldRetryInitFailure allows retry when the wall clock moves backwards`() {
        // A clock change must not wedge the user on the block screen forever.
        assertTrue(
            WebViewCompatibilityChecker.shouldRetryInitFailure(
                lastRetryAt = 10_000L,
                now = 5_000L,
                windowMs = 60_000L,
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
