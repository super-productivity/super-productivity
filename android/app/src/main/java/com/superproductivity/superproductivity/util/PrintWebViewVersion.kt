package com.superproductivity.superproductivity.util

import android.os.Build
import android.util.Log
import android.webkit.WebView
import android.webkit.WebView.getCurrentWebViewPackage

/**
 * Logs detailed WebView version and provider information for debugging.
 * This helps diagnose WebView-related issues, especially on older Android versions.
 * See: https://github.com/super-productivity/super-productivity/issues/5285
 */
fun printWebViewVersion(webView: WebView) {
    val tag = "SP-WebView"

    // Log user agent and AppleWebKit version
    val userAgent = webView.settings.userAgentString
    var webViewVersion: String? = null
    userAgent?.let {
        val startIndex = it.indexOf("AppleWebKit/") + "AppleWebKit/".length
        if (startIndex > 0) {
            webViewVersion = it.substring(startIndex)
        }
    }
    Log.i(tag, "AppleWebKit version: ${webViewVersion ?: "unknown"}")

    // Log WebView provider package and version (API 26+)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val pkg = getCurrentWebViewPackage()
        if (pkg != null) {
            Log.i(tag, "Provider: ${pkg.packageName}")
            Log.i(tag, "Provider version: ${pkg.versionName} (${pkg.versionCode})")
        } else {
            Log.w(tag, "WebView provider package is null")
        }
    }

    // Log Android version for context
    Log.i(tag, "Android version: ${Build.VERSION.SDK_INT} (${Build.VERSION.RELEASE})")
    Log.i(tag, "Device: ${Build.MANUFACTURER} ${Build.MODEL}")
}
