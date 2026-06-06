package com.superproductivity.superproductivity.util

import android.os.Build
import android.util.Log
import android.webkit.WebView
import android.webkit.WebView.getCurrentWebViewPackage
import androidx.core.content.pm.PackageInfoCompat
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker

/**
 * Logs detailed WebView version and provider information for debugging.
 * This helps diagnose WebView-related issues, especially on older Android versions.
 * See: https://github.com/super-productivity/super-productivity/issues/5285
 */
fun printWebViewVersion(webView: WebView) {
    val tag = "SP-WebView"

    // Log user agent and AppleWebKit version
    try {
        val userAgent = webView.settings.userAgentString
        var webViewVersion: String? = null
        userAgent?.let {
            val startIndex = it.indexOf("AppleWebKit/") + "AppleWebKit/".length
            if (startIndex > 0) {
                webViewVersion = it.substring(startIndex)
            }
        }
        Log.i(tag, "AppleWebKit version: ${webViewVersion ?: "unknown"}")
    } catch (e: Throwable) {
        rethrowUnlessRecoverableWebViewProbeFailure(e, "Unable to read WebView user agent")
    }

    // Log WebView provider package and version (API 26+)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try {
            val pkg = getCurrentWebViewPackage()
            if (pkg != null) {
                Log.i(tag, "Provider: ${pkg.packageName}")
                Log.i(tag, "Provider version: ${pkg.versionName} (${PackageInfoCompat.getLongVersionCode(pkg)})")
            } else {
                Log.w(tag, "WebView provider package is null")
            }
        } catch (e: Throwable) {
            rethrowUnlessRecoverableWebViewProbeFailure(e, "Unable to read WebView provider")
        }
    }

    // Log Android version for context
    Log.i(tag, "Android version: ${Build.VERSION.SDK_INT} (${Build.VERSION.RELEASE})")
    Log.i(tag, "Device: ${Build.MANUFACTURER} ${Build.MODEL}")
}

private fun rethrowUnlessRecoverableWebViewProbeFailure(error: Throwable, message: String) {
    if (containsFatalJvmError(error)) {
        throw error
    }
    if (error is Exception || WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error)) {
        Log.w("SP-WebView", message, error)
        return
    }
    throw error
}

private fun containsFatalJvmError(error: Throwable): Boolean =
    generateSequence(error) { it.cause }
        .take(8)
        .any { it is VirtualMachineError || it is ThreadDeath }
