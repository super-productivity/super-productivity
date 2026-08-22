package com.superproductivity.superproductivity.webview

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeInsetShimGateTest {

    @Test
    fun `runs on the API 34 old-WebView gap reported in 9316`() {
        // OnePlus 7T Pro / crDroid (Android 14) with the ROM's own
        // com.android.webview 124, and a bigme HiBreak Pro on WebView 126.
        // SystemBars pads for neither (< 140 and < API 35), so the add-task bar
        // sat behind the keyboard. This is the regression this gate fixes.
        assertTrue(NativeInsetShimGate.shouldRunShim(sdkInt = 34, webViewMajor = 124))
        assertTrue(NativeInsetShimGate.shouldRunShim(sdkInt = 34, webViewMajor = 126))
    }

    @Test
    fun `still runs on the API 28 case it was originally written for`() {
        assertTrue(NativeInsetShimGate.shouldRunShim(sdkInt = 28, webViewMajor = 100))
    }

    @Test
    fun `off once SystemBars passthrough owns the insets`() {
        // WebView >= 140 pads the WebView parent itself; running as well would
        // double-count and re-create the squashed WebView of #8508.
        assertFalse(NativeInsetShimGate.shouldRunShim(sdkInt = 34, webViewMajor = 140))
        assertFalse(NativeInsetShimGate.shouldRunShim(sdkInt = 28, webViewMajor = 151))
    }

    @Test
    fun `off from API 35 regardless of WebView version`() {
        // SystemBars' unconditional SDK >= 35 branch owns the IME padding there,
        // so the shim must stay a strict no-op even on an ancient WebView.
        assertFalse(NativeInsetShimGate.shouldRunShim(sdkInt = 35, webViewMajor = 124))
        assertFalse(NativeInsetShimGate.shouldRunShim(sdkInt = 36, webViewMajor = null))
    }

    @Test
    fun `runs when the WebView version cannot be read below API 35`() {
        // SystemBars reads the same provider and treats an unreadable version as
        // 0, so it skips its passthrough branch too. Both off would strand the
        // device with no inset owner at all.
        assertTrue(NativeInsetShimGate.shouldRunShim(sdkInt = 34, webViewMajor = null))
        assertTrue(NativeInsetShimGate.shouldRunShim(sdkInt = 28, webViewMajor = null))
    }

    @Test
    fun `ignores a version scanned from an installed-but-disabled provider`() {
        // The crDroid layout in #9316: getCurrentWebViewPackage() failed, so the
        // checker's PackageManager scan reported the *disabled* Google package
        // (150) while the active provider is com.android.webview 124. SystemBars
        // reads 0 there and does nothing, so trusting 150 would leave the device
        // with no inset owner — the exact bug. Degrade to null and run the shim.
        val scanned = result(
            majorVersion = 150,
            source = WebViewCompatibilityChecker.VersionSource.PACKAGE,
            providerPackageIsCurrent = false,
        )
        assertNull(NativeInsetShimGate.activeProviderMajor(scanned))
        assertTrue(
            NativeInsetShimGate.shouldRunShim(
                sdkInt = 34,
                webViewMajor = NativeInsetShimGate.activeProviderMajor(scanned),
            )
        )
    }

    @Test
    fun `trusts versions that describe the provider actually in use`() {
        // getCurrentWebViewPackage() and the user-agent string both describe the
        // active provider, which is what SystemBars branches on.
        assertEquals(
            124,
            NativeInsetShimGate.activeProviderMajor(
                result(
                    majorVersion = 124,
                    source = WebViewCompatibilityChecker.VersionSource.PACKAGE,
                    providerPackageIsCurrent = true,
                )
            )
        )
        assertEquals(
            126,
            NativeInsetShimGate.activeProviderMajor(
                result(
                    majorVersion = 126,
                    source = WebViewCompatibilityChecker.VersionSource.USER_AGENT,
                    providerPackageIsCurrent = false,
                )
            )
        )
    }

    @Test
    fun `runs when the compatibility check produced no result at all`() {
        assertNull(NativeInsetShimGate.activeProviderMajor(null))
        assertTrue(
            NativeInsetShimGate.shouldRunShim(
                sdkInt = 34,
                webViewMajor = NativeInsetShimGate.activeProviderMajor(null),
            )
        )
    }

    private fun result(
        majorVersion: Int?,
        source: WebViewCompatibilityChecker.VersionSource,
        providerPackageIsCurrent: Boolean,
    ) = WebViewCompatibilityChecker.Result(
        status = WebViewCompatibilityChecker.Status.OK,
        majorVersion = majorVersion,
        providerPackage = null,
        providerVersionName = null,
        source = source,
        providerPackageIsCurrent = providerPackageIsCurrent,
    )
}
