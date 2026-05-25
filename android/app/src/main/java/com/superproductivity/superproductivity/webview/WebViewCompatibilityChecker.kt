package com.superproductivity.superproductivity.webview

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.annotation.VisibleForTesting
import androidx.core.content.pm.PackageInfoCompat
import com.superproductivity.superproductivity.R

object WebViewCompatibilityChecker {
    private const val TAG = "WebViewCompat"
    private const val PREFS_NAME = "webview_compatibility"
    private const val KEY_LAST_GOOD_VERSION = "last_known_good_major_version"
    private const val KEY_BLOCK_OVERRIDE = "block_override"
    private const val DEFAULT_WEBVIEW_PACKAGE = "com.google.android.webview"

    const val MIN_CHROMIUM_VERSION = 107
    const val RECOMMENDED_CHROMIUM_VERSION = 110

    // System WebView providers and Chromium-based browsers whose version is a
    // reasonable proxy when WebView.getCurrentWebViewPackage() is unavailable.
    // The match is treated as non-authoritative (canBlockBasedOnVersion = false),
    // so a wrong match here can only ever produce WARN, never BLOCK.
    private val KNOWN_WEBVIEW_PACKAGES = listOf(
        "com.google.android.webview",
        "com.android.webview",
        "com.android.chrome",
        "com.chrome.beta",
        "com.chrome.dev",
        "com.chrome.canary",
        "com.sec.android.app.sbrowser",
        "com.huawei.webview",
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

        // The WebView could not be instantiated at all (factory threw, bridge.webView
        // null, etc.). Set by call sites that force BLOCK for non-version reasons so
        // user screenshots distinguish "version too old" from "WebView refused to init".
        INIT_FAILURE,
    }

    enum class BlockScreenAction {
        UPDATE_WEBVIEW,
        OPEN_WEBVIEW_SETTINGS_WITH_WARNING,
    }

    data class BlockScreenConfig(
        val titleResId: Int,
        val detailsIntroResId: Int?,
        val action: BlockScreenAction,
        val showTryAnyway: Boolean,
        val showSource: Boolean,
    )

    data class Result(
        val status: Status,
        val majorVersion: Int?,
        val providerPackage: String?,
        val providerVersionName: String?,
        val source: VersionSource,
        val providerPackageIsCurrent: Boolean = false,
    ) {
        val isBlocked: Boolean
            get() = status == Status.BLOCK
    }

    fun evaluate(context: Context): Result {
        val resolvedPackageInfo = resolvePackageInfo(context)
        val packageInfo = resolvedPackageInfo?.packageInfo
        val packageMajor =
            packageInfo?.let { parseMajorVersion(it.versionName) ?: parseMajorVersion(it.longVersionCode) }

        val userAgentMajor = resolveFromUserAgent(context)
        val providerPackageIsCurrent = resolvedPackageInfo?.canBlockBasedOnVersion == true

        val raw = when {
            shouldPreferCurrentProviderPackage(
                packageMajor = packageMajor,
                providerPackageIsCurrent = providerPackageIsCurrent,
            ) -> buildResult(
                majorVersion = packageMajor,
                packageInfo = packageInfo,
                source = VersionSource.PACKAGE,
                canBlockBasedOnVersion = true,
                providerPackageIsCurrent = true,
            )
            userAgentMajor != null -> buildResult(
                majorVersion = userAgentMajor,
                packageInfo = packageInfo,
                source = VersionSource.USER_AGENT,
                canBlockBasedOnVersion = true,
                providerPackageIsCurrent = providerPackageIsCurrent,
            )
            packageMajor != null && resolvedPackageInfo.canBlockBasedOnVersion -> buildResult(
                majorVersion = packageMajor,
                packageInfo = packageInfo,
                source = VersionSource.PACKAGE,
                canBlockBasedOnVersion = true,
                providerPackageIsCurrent = true,
            )
            packageMajor != null -> buildResult(
                majorVersion = packageMajor,
                packageInfo = packageInfo,
                source = VersionSource.PACKAGE,
                canBlockBasedOnVersion = false,
            )
            else -> buildResult(
                majorVersion = null,
                packageInfo = packageInfo,
                source = VersionSource.UNKNOWN,
                canBlockBasedOnVersion = false,
            )
        }

        val prefs = preferences(context)
        val lastGood = prefs.getInt(KEY_LAST_GOOD_VERSION, -1).takeIf { it > 0 }
        val override = prefs.getBoolean(KEY_BLOCK_OVERRIDE, false)
        val finalStatus = applyOverrides(raw.status, lastGood, override)

        if (Log.isLoggable(TAG, Log.DEBUG)) {
            Log.d(
                TAG,
                "evaluate: pkg=${packageInfo?.packageName}/${packageInfo?.versionName} " +
                    "uaMajor=$userAgentMajor pkgMajor=$packageMajor " +
                    "canBlockFromPkg=${resolvedPackageInfo?.canBlockBasedOnVersion} " +
                    "lastGood=$lastGood override=$override " +
                    "raw=${raw.status} final=$finalStatus source=${raw.source}",
            )
        }

        return raw.copy(status = finalStatus)
    }

    /**
     * Records that the WebView successfully loaded with [majorVersion]. If the device ever
     * reports a lower version in the future (e.g. flaky version detection), [evaluate]
     * downgrades a BLOCK to WARN so the user is not locked out by a transient mis-read.
     *
     * Auto-clears any prior user "Try anyway" override once the device reaches a healthy
     * version, so a future genuine block (e.g. WebView downgrade) is not silently bypassed.
     */
    fun recordSuccessfulLoad(context: Context, majorVersion: Int?) {
        if (majorVersion == null || majorVersion <= 0) return
        val prefs = preferences(context)
        val needsVersionUpdate = majorVersion > prefs.getInt(KEY_LAST_GOOD_VERSION, -1)
        val needsOverrideClear = majorVersion >= MIN_CHROMIUM_VERSION &&
            prefs.getBoolean(KEY_BLOCK_OVERRIDE, false)
        if (!needsVersionUpdate && !needsOverrideClear) return
        val edit = prefs.edit()
        if (needsVersionUpdate) edit.putInt(KEY_LAST_GOOD_VERSION, majorVersion)
        if (needsOverrideClear) edit.putBoolean(KEY_BLOCK_OVERRIDE, false)
        edit.apply()
    }

    /**
     * Persists the user's decision to bypass the version-based block screen. Uses
     * [SharedPreferences.Editor.commit] (sync) because the call site immediately
     * relaunches the app — an async write could be lost if the process is killed
     * during the relaunch and the user would loop back to the block screen.
     */
    fun setBlockOverride(context: Context, enabled: Boolean) {
        preferences(context).edit().putBoolean(KEY_BLOCK_OVERRIDE, enabled).commit()
    }

    @VisibleForTesting
    internal fun sourceFromName(sourceName: String?): VersionSource {
        if (sourceName.isNullOrBlank()) return VersionSource.UNKNOWN
        return runCatching { VersionSource.valueOf(sourceName) }.getOrDefault(VersionSource.UNKNOWN)
    }

    @VisibleForTesting
    internal fun canBypassBlock(source: VersionSource): Boolean =
        source != VersionSource.INIT_FAILURE

    @VisibleForTesting
    internal fun shouldPreferCurrentProviderPackage(
        packageMajor: Int?,
        providerPackageIsCurrent: Boolean,
    ): Boolean =
        providerPackageIsCurrent && packageMajor != null && packageMajor >= MIN_CHROMIUM_VERSION

    @VisibleForTesting
    internal fun blockScreenConfig(
        source: VersionSource,
        hasProviderDetails: Boolean,
    ): BlockScreenConfig {
        val isInitFailure = source == VersionSource.INIT_FAILURE
        return BlockScreenConfig(
            titleResId = if (isInitFailure) {
                R.string.webview_init_failure_message
            } else {
                R.string.webview_block_message
            },
            detailsIntroResId = if (!isInitFailure) {
                null
            } else if (hasProviderDetails) {
                R.string.webview_init_failure_details_with_provider
            } else {
                R.string.webview_init_failure_details_without_provider
            },
            action = if (isInitFailure) {
                BlockScreenAction.OPEN_WEBVIEW_SETTINGS_WITH_WARNING
            } else {
                BlockScreenAction.UPDATE_WEBVIEW
            },
            showTryAnyway = canBypassBlock(source),
            showSource = source != VersionSource.UNKNOWN,
        )
    }

    @VisibleForTesting
    internal fun isLikelyWebViewInitFailure(error: Throwable): Boolean {
        val causes = generateSequence(error) { it.cause }.take(8).toList()
        if (causes.any { isFatalJvmError(it) }) return false

        return causes.any { cause ->
            isKnownWebViewInitFailureClass(cause.javaClass.name) ||
                hasKnownWebViewInitFailureMessage(cause) ||
                cause.stackTrace.take(32).any { frame ->
                    isKnownWebViewInitFrame(cause, frame.className)
                }
        }
    }

    private fun preferences(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun buildResult(
        majorVersion: Int?,
        packageInfo: PackageInfo?,
        source: VersionSource,
        canBlockBasedOnVersion: Boolean,
        providerPackageIsCurrent: Boolean = false,
    ): Result {
        val status = statusForVersion(
            majorVersion = majorVersion,
            packageName = packageInfo?.packageName,
            canBlockBasedOnVersion = canBlockBasedOnVersion,
        )
        return Result(
            status = status,
            majorVersion = majorVersion,
            providerPackage = packageInfo?.packageName,
            providerVersionName = packageInfo?.versionName,
            source = source,
            providerPackageIsCurrent = providerPackageIsCurrent,
        )
    }

    @VisibleForTesting
    internal fun statusForVersion(
        majorVersion: Int?,
        packageName: String?,
        canBlockBasedOnVersion: Boolean,
    ): Status {
        // Check if this is a third-party WebView with non-standard versioning
        val isThirdPartyWebView = packageName?.let { pkg ->
            pkg !in listOf("com.google.android.webview", "com.android.webview", "com.android.chrome")
        } ?: false

        return when {
            majorVersion == null -> Status.WARN
            // PackageManager fallback scans installed packages, not necessarily the
            // active WebView provider. Use it for diagnostics only, never lockout.
            !canBlockBasedOnVersion && majorVersion < RECOMMENDED_CHROMIUM_VERSION -> Status.WARN
            // For third-party WebViews with suspiciously low version numbers,
            // be lenient and just warn instead of blocking (they may use different versioning)
            isThirdPartyWebView && majorVersion < 50 -> Status.WARN
            majorVersion < MIN_CHROMIUM_VERSION -> Status.BLOCK
            majorVersion < RECOMMENDED_CHROMIUM_VERSION -> Status.WARN
            else -> Status.OK
        }
    }

    @VisibleForTesting
    internal fun applyOverrides(
        rawStatus: Status,
        lastKnownGoodVersion: Int?,
        userOverride: Boolean,
    ): Status {
        if (rawStatus != Status.BLOCK) return rawStatus
        if (userOverride) return Status.WARN
        if (lastKnownGoodVersion != null && lastKnownGoodVersion >= MIN_CHROMIUM_VERSION) return Status.WARN
        return Status.BLOCK
    }

    private fun resolvePackageInfo(context: Context): ResolvedPackageInfo? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Why: on devices with a broken WebView provider getCurrentWebViewPackage()
            // can throw (AndroidRuntimeException / MissingWebViewPackageException /
            // NullPointerException) rather than returning null, which would bypass
            // FullscreenActivity's recovery. Recover from known provider init failures
            // too, but keep fatal VM errors and unrelated Error subclasses visible.
            try {
                WebView.getCurrentWebViewPackage()?.let {
                    return ResolvedPackageInfo(it, canBlockBasedOnVersion = true)
                }
            } catch (e: Throwable) {
                if (!shouldRecoverFromWebViewProbeFailure(e)) throw e
                Log.d(TAG, "getCurrentWebViewPackage() threw; falling back to PackageManager", e)
            }
        }

        val pm = context.packageManager
        KNOWN_WEBVIEW_PACKAGES.forEach { packageName ->
            try {
                val info = packageInfo(pm, packageName)
                if (info != null) {
                    return ResolvedPackageInfo(info, canBlockBasedOnVersion = false)
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
        } catch (e: Throwable) {
            if (!shouldRecoverFromWebViewProbeFailure(e)) throw e
            Log.d(TAG, "getDefaultUserAgent() threw; falling back to package metadata", e)
            null
        }

        if (userAgent.isNullOrBlank()) {
            return null
        }

        // Only trust an explicit Chromium UA token. The "Version/X" Safari token is
        // hard-coded to "Version/4.0" in WebView UAs and would falsely trigger BLOCK.
        return CHROME_REGEX.find(userAgent)?.groupValues?.getOrNull(1)?.toIntOrNull()
    }

    @VisibleForTesting
    internal fun parseMajorVersion(versionName: String?): Int? {
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

    fun openWebViewUpdatePage(context: Context, providerPackage: String? = null) {
        if (!startActivitySafely(context, webViewUpdateIntent(providerPackage))) {
            Log.w(TAG, "No activity available to open WebView update page")
        }
    }

    fun openWebViewSettingsPage(context: Context, providerPackage: String?) {
        if (startActivitySafely(context, webViewSettingsIntent())) {
            return
        }

        if (!providerPackage.isNullOrBlank() &&
            startActivitySafely(context, webViewProviderDetailsIntent(providerPackage))
        ) {
            return
        }

        Log.w(TAG, "No activity available to open WebView settings; falling back to Play Store")
        openWebViewUpdatePage(context, providerPackage)
    }

    @VisibleForTesting
    internal fun webViewSettingsIntent(): Intent =
        Intent(Settings.ACTION_WEBVIEW_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    @VisibleForTesting
    internal fun webViewProviderDetailsIntent(providerPackage: String): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse(webViewProviderDetailsUri(providerPackage)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    @VisibleForTesting
    internal fun webViewUpdateIntent(providerPackage: String? = null): Intent {
        return Intent(
            Intent.ACTION_VIEW,
            Uri.parse(webViewUpdatePageUrl(providerPackage)),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    @VisibleForTesting
    internal fun webViewProviderDetailsUri(providerPackage: String): String =
        "package:$providerPackage"

    @VisibleForTesting
    internal fun webViewUpdatePageUrl(providerPackage: String? = null): String {
        val packageName = providerPackage?.takeIf { it.isNotBlank() } ?: DEFAULT_WEBVIEW_PACKAGE
        return "https://play.google.com/store/apps/details?id=$packageName"
    }

    private fun startActivitySafely(context: Context, intent: Intent): Boolean {
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    private fun shouldRecoverFromWebViewProbeFailure(error: Throwable): Boolean {
        if (containsFatalJvmError(error)) return false
        return error is Exception || isLikelyWebViewInitFailure(error)
    }

    private fun isFatalJvmError(error: Throwable): Boolean =
        error is VirtualMachineError || error is ThreadDeath

    private fun containsFatalJvmError(error: Throwable): Boolean =
        generateSequence(error) { it.cause }.take(8).any { isFatalJvmError(it) }

    private fun isKnownWebViewInitFailureClass(className: String): Boolean =
        "missingwebviewpackage" in className.lowercase()

    private fun hasKnownWebViewInitFailureMessage(error: Throwable): Boolean {
        val message = error.message?.lowercase() ?: return false
        return "missingwebviewpackage" in message ||
            "webview package" in message ||
            "webview provider" in message ||
            "webview factory" in message ||
            "libwebviewchromium" in message ||
            (error is UnsatisfiedLinkError && ("webview" in message || "chromium" in message))
    }

    private fun isKnownWebViewInitFrame(error: Throwable, className: String): Boolean {
        val isAndroidWebViewClass =
            className == "android.webkit.WebView" ||
                className.startsWith("android.webkit.WebView\$") ||
                className.startsWith("android.webkit.WebView.") ||
                className == "android.webkit.WebViewFactory" ||
                className.startsWith("android.webkit.WebViewFactory\$") ||
                className.startsWith("android.webkit.WebViewFactory.") ||
                className == "android.webkit.WebSettings" ||
                className.startsWith("android.webkit.WebSettings\$") ||
                className.startsWith("android.webkit.WebSettings.") ||
                className == "android.webkit.WebViewDelegate" ||
                className.startsWith("android.webkit.WebViewDelegate\$") ||
                className.startsWith("android.webkit.WebViewDelegate.")
        if (isAndroidWebViewClass) return true

        val isProviderRuntimeClass =
            className.startsWith("com.android.webview.chromium.") ||
                className.startsWith("org.chromium.android_webview.") ||
                className.startsWith("org.chromium.base.library_loader.")
        return error is LinkageError && isProviderRuntimeClass
    }

    private val PackageInfo.longVersionCode: Long
        get() = PackageInfoCompat.getLongVersionCode(this)

    private val CHROME_REGEX = Regex("Chrom(?:e|ium)/(\\d+)")

    private data class ResolvedPackageInfo(
        val packageInfo: PackageInfo,
        val canBlockBasedOnVersion: Boolean,
    )
}
