package com.superproductivity.superproductivity.webview

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.annotation.VisibleForTesting
import androidx.core.content.pm.PackageInfoCompat
import kotlin.math.max

object WebViewCompatibilityChecker {
    private const val TAG = "WebViewCompat"

    const val MIN_CHROMIUM_VERSION = 107
    const val RECOMMENDED_CHROMIUM_VERSION = 110

    private val KNOWN_WEBVIEW_PACKAGES = listOf(
        "com.google.android.webview",
        "com.android.webview",
        "com.android.chrome",
        "com.sec.android.app.sbrowser",
        "com.mi.globalbrowser",
        "com.huawei.webview",
        "org.mozilla.firefox",
    )

    enum class Status {
        BLOCK,
        WARN,
        OK,
    }

    enum class VersionSource {
        PACKAGE,
        USER_AGENT,
        UNKNOWN,
    }

    data class Result(
        val status: Status,
        val majorVersion: Int?,
        val providerPackage: String?,
        val providerVersionName: String?,
        val source: VersionSource,
    ) {
        val isBlocked: Boolean
            get() = status == Status.BLOCK
    }

    fun evaluate(context: Context): Result {
        val packageInfo = resolvePackageInfo(context)
        val packageMajor =
            packageInfo?.let { parseMajorVersion(it.versionName) ?: parseMajorVersion(it.versionCode) }

        if (packageMajor != null) {
            return buildResult(
                majorVersion = packageMajor,
                packageInfo = packageInfo,
                source = VersionSource.PACKAGE,
            )
        }

        val userAgentMajor = resolveFromUserAgent(context)
        if (userAgentMajor != null) {
            return buildResult(
                majorVersion = userAgentMajor,
                packageInfo = packageInfo,
                source = VersionSource.USER_AGENT,
            )
        }

        return buildResult(
            majorVersion = null,
            packageInfo = packageInfo,
            source = VersionSource.UNKNOWN,
        )
    }

    private fun buildResult(
        majorVersion: Int?,
        packageInfo: PackageInfo?,
        source: VersionSource,
    ): Result {
        // Check if this is a third-party WebView with non-standard versioning
        val isThirdPartyWebView = packageInfo?.packageName?.let { pkg ->
            pkg !in listOf("com.google.android.webview", "com.android.webview", "com.android.chrome")
        } ?: false

        val status = when {
            majorVersion == null -> Status.WARN
            // For third-party WebViews with suspiciously low version numbers,
            // be lenient and just warn instead of blocking (they may use different versioning)
            isThirdPartyWebView && majorVersion < 50 -> Status.WARN
            majorVersion < MIN_CHROMIUM_VERSION -> Status.BLOCK
            majorVersion < RECOMMENDED_CHROMIUM_VERSION -> Status.WARN
            else -> Status.OK
        }
        return Result(
            status = status,
            majorVersion = majorVersion,
            providerPackage = packageInfo?.packageName,
            providerVersionName = packageInfo?.versionName,
            source = source,
        )
    }

    private fun resolvePackageInfo(context: Context): PackageInfo? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Why: on devices with a broken WebView provider getCurrentWebViewPackage()
            // can throw (AndroidRuntimeException / MissingWebViewPackageException /
            // NullPointerException) rather than returning null, which would bypass
            // FullscreenActivity's recovery. All three extend RuntimeException;
            // keep the catch narrow so non-runtime failures still surface.
            try {
                WebView.getCurrentWebViewPackage()?.let { return it }
            } catch (e: RuntimeException) {
                Log.d(TAG, "getCurrentWebViewPackage() threw; falling back to PackageManager", e)
            }
        }

        val pm = context.packageManager
        KNOWN_WEBVIEW_PACKAGES.forEach { packageName ->
            try {
                val info = packageInfo(pm, packageName)
                if (info != null) {
                    return info
                }
            } catch (_: PackageManager.NameNotFoundException) {
                // Ignore and continue
            }
        }
        return null
    }

    private fun packageInfo(pm: PackageManager, packageName: String): PackageInfo? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(packageName, 0)
        }
    }

    private fun resolveFromUserAgent(context: Context): Int? {
        val userAgent = try {
            WebSettings.getDefaultUserAgent(context)
        } catch (_: Exception) {
            null
        }

        if (userAgent.isNullOrBlank()) {
            return null
        }

        val chromeMatch = CHROME_REGEX.find(userAgent)?.groupValues?.getOrNull(1)?.toIntOrNull()
        if (chromeMatch != null) {
            return chromeMatch
        }

        val versionMatch = VERSION_REGEX.find(userAgent)?.groupValues?.getOrNull(1)?.toIntOrNull()
        return versionMatch
    }

    private fun parseMajorVersion(versionName: String?): Int? {
        if (versionName.isNullOrBlank()) {
            return null
        }
        val candidate = versionName.takeWhile { it.isDigit() || it == '.' }
        val firstSegment = candidate.split('.').firstOrNull() ?: return null
        return firstSegment.toIntOrNull()
    }

    private fun parseMajorVersion(versionCode: Long): Int? {
        if (versionCode <= 0) {
            return null
        }
        val numeric = versionCode.toString()
        return numeric.take(3).toIntOrNull()
    }

    @VisibleForTesting
    internal fun parseMajorVersion(versionCode: Int): Int? {
        if (versionCode <= 0) {
            return null
        }
        val numeric = versionCode.toString()
        return numeric.take(3).toIntOrNull()
    }

    fun openWebViewUpdatePage(context: Context) {
        val updateIntent =
            Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(updateIntent)
    }

    private val PackageInfo.versionCode: Long
        get() = PackageInfoCompat.getLongVersionCode(this)

    private val CHROME_REGEX = Regex("Chrom(?:e|ium)/(\\d+)")
    private val VERSION_REGEX = Regex("Version/(\\d+)")
}
