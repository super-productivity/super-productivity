package com.superproductivity.superproductivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.webkit.WebView
import android.widget.Toast
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.anggrayudi.storage.SimpleStorageHelper
import com.getcapacitor.BridgeActivity
import com.superproductivity.superproductivity.plugins.NavigationBarPlugin
import com.superproductivity.superproductivity.plugins.SafBridgePlugin
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.service.FocusModeForegroundService
import com.superproductivity.superproductivity.service.FocusModeNotificationHelper
import com.superproductivity.superproductivity.service.ForegroundServiceFailure
import com.superproductivity.superproductivity.service.SyncReminderScheduler
import com.superproductivity.superproductivity.service.TrackingForegroundService
import com.superproductivity.superproductivity.util.printWebViewVersion
import com.superproductivity.superproductivity.webview.JavaScriptInterface
import com.superproductivity.superproductivity.webview.WebHelper
import com.superproductivity.superproductivity.webview.WebViewBlockActivity
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker
import com.superproductivity.superproductivity.webview.WebViewRecovery
import com.superproductivity.superproductivity.widget.ShareIntentQueue
import com.superproductivity.superproductivity.widget.StartupOverlayManager
import com.superproductivity.plugins.webdavhttp.WebDavHttpPlugin
import org.json.JSONObject

/**
 * All new Super-Productivity main activity, based on Capacitor to support offline use of the entire application
 */
class CapacitorMainActivity : BridgeActivity() {
    private lateinit var javaScriptInterface: JavaScriptInterface
    private var webViewCompatibility: WebViewCompatibilityChecker.Result? = null
    private var webViewBlocked = false
    private var webViewRecoveryScheduled = false
    private var pendingShareIntent: JSONObject? = null
    private var isFrontendReady = false
    private var startupOverlayManager: StartupOverlayManager? = null
    private var isTimerCompleteReceiverRegistered = false
    private var isForegroundServiceFailureReceiverRegistered = false

    private val storageHelper =
        SimpleStorageHelper(this) // for scoped storage permission management on Android 10+

    private val timerCompleteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == FocusModeForegroundService.ACTION_TIMER_COMPLETE) {
                val isBreak = intent.getBooleanExtra(FocusModeForegroundService.EXTRA_IS_BREAK, false)
                Log.d("SP_FOCUS", "Timer complete broadcast received, isBreak=$isBreak")
                callJSInterfaceFunctionIfExists("next", "onFocusModeTimerComplete$", isBreak.toString())
            }
        }
    }

    private val foregroundServiceFailureReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ForegroundServiceFailure.ACTION) {
                return
            }
            val service = intent.getStringExtra(ForegroundServiceFailure.EXTRA_SERVICE) ?: return
            val reason = intent.getStringExtra(ForegroundServiceFailure.EXTRA_REASON) ?: return
            callJSInterfaceFunctionIfExists(
                "next",
                "onForegroundServiceStartFailed$",
                "{service:${JSONObject.quote(service)},reason:${JSONObject.quote(reason)}}"
            )
        }
    }

    override fun load() {
        val result = try {
            WebViewCompatibilityChecker.evaluate(this)
        } catch (e: Throwable) {
            showWebViewInitFailureOrThrow("WebView compatibility check failed", e)
            return
        }
        webViewCompatibility = result
        if (result.isBlocked) {
            webViewBlocked = true
            WebViewBlockActivity.present(this, result)
            finish()
            return
        }
        try {
            super.load()
        } catch (e: Throwable) {
            showWebViewInitFailureOrThrow("BridgeActivity.load() failed to initialize WebView", e)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Register plugins before calling super.onCreate()
        registerPlugin(SafBridgePlugin::class.java)
        registerPlugin(WebDavHttpPlugin::class.java)
        registerPlugin(NavigationBarPlugin::class.java)

        try {
            super.onCreate(savedInstanceState)
        } catch (e: Throwable) {
            showWebViewInitFailureOrThrow("BridgeActivity.onCreate() failed to initialize WebView", e)
            return
        }
        // A recovery relaunch was scheduled during super.onCreate()/load(); don't
        // fall through to the (now-doomed) bridge.webView null check and re-handle it.
        if (webViewBlocked || webViewRecoveryScheduled) {
            return
        }

        val webView = bridge?.webView
        if (webView == null) {
            showWebViewInitFailure("Bridge or WebView is null after onCreate")
            return
        }

        try {
            printWebViewVersion(webView)

            // DEBUG ONLY
            if (BuildConfig.DEBUG) {
                Handler(Looper.getMainLooper()).postDelayed({
                    val debugToast = Toast.makeText(this, "DEBUG", Toast.LENGTH_SHORT)
                    debugToast.show()
                    Handler(Looper.getMainLooper()).postDelayed({ debugToast.cancel() }, 100)
                }, 10_000)
                WebView.setWebContentsDebuggingEnabled(true)
            }

            webViewCompatibility?.let {
                if (it.status == WebViewCompatibilityChecker.Status.WARN) {
                    Log.w(
                        "SP-WebView",
                        "WebView version ${it.majorVersion ?: "unknown"} below recommended ${WebViewCompatibilityChecker.RECOMMENDED_CHROMIUM_VERSION}",
                    )
                }
            }

            // Hide the action bar
            supportActionBar?.hide()

            // Initialize JavaScriptInterface
            javaScriptInterface = JavaScriptInterface(this, webView)

            // Initialize WebView
            WebHelper().setupView(webView, false)

            // Inject JavaScriptInterface into Capacitor's WebView
            webView.addJavascriptInterface(
                javaScriptInterface,
                WINDOW_INTERFACE_PROPERTY
            )
            if (BuildConfig.FLAVOR.equals("fdroid")) {
                webView.addJavascriptInterface(
                    javaScriptInterface,
                    WINDOW_PROPERTY_F_DROID
                )
            }
        } catch (e: Throwable) {
            showWebViewInitFailureOrThrow("WebView setup failed", e)
            return
        }

        // We made it past the pre-flight version check and the WebView setup.
        // Persist the detected version so a transient mis-read on a later launch
        // can't lock the user out, and clear any prior user override if healthy.
        WebViewCompatibilityChecker.recordSuccessfulLoad(this, webViewCompatibility?.majorVersion)


        // Handle keyboard visibility changes
        val rootView = findViewById<View>(android.R.id.content)
        rootView.viewTreeObserver.addOnGlobalLayoutListener {
            val rect = Rect()
            rootView.getWindowVisibleDisplayFrame(rect)
            val screenHeight = rootView.rootView.height

            val keypadHeight = screenHeight - rect.bottom
            if (keypadHeight > screenHeight * 0.15) {
                // keyboard is opened
                callJSInterfaceFunctionIfExists("next", "isKeyboardShown$", "true")
            } else {
                // keyboard is closed
                callJSInterfaceFunctionIfExists("next", "isKeyboardShown$", "false")
            }
        }

        // Register broadcast receiver for focus mode timer completion
        LocalBroadcastManager.getInstance(this).registerReceiver(
            timerCompleteReceiver,
            IntentFilter(FocusModeForegroundService.ACTION_TIMER_COMPLETE)
        )
        isTimerCompleteReceiverRegistered = true
        LocalBroadcastManager.getInstance(this).registerReceiver(
            foregroundServiceFailureReceiver,
            IntentFilter(ForegroundServiceFailure.ACTION)
        )
        isForegroundServiceFailureReceiverRegistered = true

        // Show startup overlay for quick task entry while Angular loads.
        // Only on fresh cold start — not on config-change recreation.
        if (savedInstanceState == null) {
            startupOverlayManager = StartupOverlayManager(this)
            startupOverlayManager?.show()
        }

        // Schedule background sync worker if credentials are configured
        if (BackgroundSyncCredentialStore.get(this) != null) {
            SyncReminderScheduler.ensureScheduled(this)
        }

        // Handle initial intent (cold start) only on a fresh launch.
        // On Activity recreation (config change) savedInstanceState is non-null
        // and getIntent() still holds the original share/reminder Intent — re-running
        // handleIntent() there would create a duplicate task from the same share.
        if (savedInstanceState == null) {
            handleIntent(intent)
        }
    }

    private fun showWebViewInitFailureOrThrow(message: String, error: Throwable) {
        if (!WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error)) {
            throw error
        }
        recoverOrShowWebViewInitFailure(message, error)
    }

    private fun showWebViewInitFailure(message: String, error: Throwable? = null) {
        recoverOrShowWebViewInitFailure(message, error)
    }

    /**
     * WebView init failures are usually transient, and the user's own workaround is
     * to relaunch the app — so attempt that automatically once (via [WebViewRecovery])
     * before surfacing the terminal block screen. [WebViewCompatibilityChecker] caps
     * this at one relaunch per window so a genuinely broken provider still reaches
     * the block screen instead of boot-looping. The [webViewRecoveryScheduled] flag
     * stops Capacitor's multiple onCreate/load() failure checkpoints from each
     * scheduling a relaunch. → issue #7518.
     */
    private fun recoverOrShowWebViewInitFailure(message: String, error: Throwable?) {
        if (webViewBlocked || webViewRecoveryScheduled) {
            return
        }
        if (WebViewCompatibilityChecker.canRetryInitFailure(this)) {
            webViewRecoveryScheduled = true
            Log.w("CapacitorMainActivity", "$message - scheduling one-shot WebView recovery relaunch")
            WebViewRecovery.scheduleRelaunch(this)
            return
        }
        blockForWebViewInitFailure(message, error)
    }

    private fun blockForWebViewInitFailure(message: String, error: Throwable?) {
        if (error == null) {
            Log.e("CapacitorMainActivity", "$message - finishing activity")
        } else {
            Log.e("CapacitorMainActivity", "$message - finishing activity", error)
        }
        webViewBlocked = true
        WebViewBlockActivity.present(this, webViewInitFailureResult())
        finish()
    }

    private fun webViewInitFailureResult(): WebViewCompatibilityChecker.Result =
        (webViewCompatibility ?: WebViewCompatibilityChecker.Result(
            status = WebViewCompatibilityChecker.Status.BLOCK,
            majorVersion = null,
            providerPackage = null,
            providerVersionName = null,
            source = WebViewCompatibilityChecker.VersionSource.INIT_FAILURE,
        )).copy(
            status = WebViewCompatibilityChecker.Status.BLOCK,
            source = WebViewCompatibilityChecker.VersionSource.INIT_FAILURE,
        )

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    fun getStartupOverlayPartialText(): String? {
        return startupOverlayManager?.getPartialTextAndPrepare()
    }

    fun hideStartupOverlay() {
        if (startupOverlayManager != null) {
            startupOverlayManager?.hide()
            startupOverlayManager = null
        }
    }

    fun dismissStartupOverlay() {
        startupOverlayManager?.dismiss()
        startupOverlayManager = null
    }

    fun flushPendingShareIntent() {
        isFrontendReady = true
        pendingShareIntent?.let {
            Log.d("SP_SHARE", "Flushing pending share intent: $it")
            callJSInterfaceFunctionIfExists("next", "onShareWithAttachment$", it.toString())
            pendingShareIntent = null
            ShareIntentQueue.getAndClear(this)
        }
    }

    fun clearPendingShareIntent() {
        pendingShareIntent = null
    }

    private fun handleIntent(intent: Intent) {
        Log.d("SP_SHARE", "handleIntent action: ${intent.action} type: ${intent.type}")

        // Handle reminder notification tap
        val reminderTaskId = intent.getStringExtra("REMINDER_TASK_ID")
        if (reminderTaskId != null) {
            // Sanitize to prevent JS injection (only allow alphanumeric, dash, underscore)
            val sanitizedId = reminderTaskId.replace(Regex("[^a-zA-Z0-9_-]"), "")
            Log.d("SP_REMINDER", "Reminder tap: taskId=$sanitizedId")
            // Persist for pull-based retrieval (WebView may not be ready on cold start)
            com.superproductivity.superproductivity.widget.ReminderTapQueue.setTaskId(this, sanitizedId)
            // Also try push-based delivery (works on warm start)
            callJSInterfaceFunctionIfExists("next", "onReminderTap$", "'$sanitizedId'")
            intent.removeExtra("REMINDER_TASK_ID")
            return
        }

        // Handle tracking notification actions
        when (intent.action) {
            TrackingForegroundService.ACTION_PAUSE -> {
                Log.d("SP_TRACKING", "Pause action received from notification")
                callJSInterfaceFunctionIfExists("next", "onPauseTracking$")
                return
            }
            TrackingForegroundService.ACTION_DONE -> {
                Log.d("SP_TRACKING", "Done action received from notification")
                callJSInterfaceFunctionIfExists("next", "onMarkTaskDone$")
                return
            }
            // Handle focus mode notification actions
            FocusModeForegroundService.ACTION_PAUSE -> {
                Log.d("SP_FOCUS", "Pause action received from focus mode notification")
                callJSInterfaceFunctionIfExists("next", "onFocusPause$")
                return
            }
            FocusModeForegroundService.ACTION_RESUME -> {
                Log.d("SP_FOCUS", "Resume action received from focus mode notification")
                callJSInterfaceFunctionIfExists("next", "onFocusResume$")
                return
            }
            FocusModeForegroundService.ACTION_SKIP -> {
                Log.d("SP_FOCUS", "Skip action received from focus mode notification")
                FocusModeNotificationHelper.cancelCompletionNotification(this)
                callJSInterfaceFunctionIfExists("next", "onFocusSkip$")
                return
            }
            FocusModeForegroundService.ACTION_COMPLETE -> {
                Log.d("SP_FOCUS", "Complete action received from focus mode notification")
                FocusModeNotificationHelper.cancelCompletionNotification(this)
                callJSInterfaceFunctionIfExists("next", "onFocusComplete$")
                return
            }
        }

        // Handle share intent
        if (Intent.ACTION_SEND == intent.action && intent.type != null) {
            if (intent.type?.startsWith("text/") == true) {
                val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                // Leave title/subject empty when absent so the frontend can derive a
                // meaningful title from the URL or note content. Defaulting to a literal
                // "Shared Content" here masks that derivation (issue: blank shared tasks).
                val sharedTitle = intent.getStringExtra(Intent.EXTRA_TITLE) ?: ""
                val sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
                Log.d("SP_SHARE", "Shared text: $sharedText")
                Log.d("SP_SHARE", "Shared title: $sharedTitle")
                Log.d("SP_SHARE", "Shared subject: $sharedSubject")

                // Ignore empty/blank shares — they only produce useless blank tasks.
                if (!sharedText.isNullOrBlank()) {
                    val json = JSONObject()
                    json.put("title", sharedTitle)
                    json.put("subject", sharedSubject)
                    val type = if (sharedText.startsWith("http")) "LINK" else "NOTE"
                    json.put("type", type)
                    json.put("path", sharedText)

                    // Always persist for crash safety
                    ShareIntentQueue.setPending(this, json.toString())

                    if (isFrontendReady) {
                        Log.d("SP_SHARE", "Frontend ready, sending directly: $json")
                        callJSInterfaceFunctionIfExists("next", "onShareWithAttachment$", json.toString())
                        pendingShareIntent = null
                        ShareIntentQueue.getAndClear(this)
                    } else {
                        Log.d("SP_SHARE", "Frontend NOT ready, queueing: $json")
                        pendingShareIntent = json
                        Toast.makeText(this, R.string.share_received, Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        // Save scoped storage permission on Android 10+
        storageHelper.onSaveInstanceState(outState)
        bridge?.webView?.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        // Restore scoped storage permission on Android 10+
        storageHelper.onRestoreInstanceState(savedInstanceState)
        bridge?.webView?.restoreState(savedInstanceState)
    }

    override fun onPause() {
        super.onPause()
        Log.v("TW", "CapacitorFullscreenActivity: onPause")
        callJSInterfaceFunctionIfExists("next", "onPause$")
    }

    override fun onResume() {
        super.onResume()
        Log.v("TW", "CapacitorFullscreenActivity: onResume")
        callJSInterfaceFunctionIfExists("next", "onResume$")
    }

    private fun callJSInterfaceFunctionIfExists(
        fnName: String,
        objectPath: String,
        fnParam: String = ""
    ) {
        if (!::javaScriptInterface.isInitialized) {
            Log.w("CapacitorMainActivity", "javaScriptInterface not initialized yet. Skipping JS call.")
            return
        }
        val fnFullName =
            "window.${FullscreenActivity.WINDOW_INTERFACE_PROPERTY}.$objectPath.$fnName"
        val fullObjectPath = "window.${FullscreenActivity.WINDOW_INTERFACE_PROPERTY}.$objectPath"
        javaScriptInterface.callJavaScriptFunction("if($fullObjectPath && $fnFullName)$fnFullName($fnParam)")
    }


    override fun onDestroy() {
        startupOverlayManager?.dismiss()
        startupOverlayManager = null
        if (isTimerCompleteReceiverRegistered) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(timerCompleteReceiver)
            isTimerCompleteReceiverRegistered = false
        }
        if (isForegroundServiceFailureReceiverRegistered) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(
                foregroundServiceFailureReceiver
            )
            isForegroundServiceFailureReceiverRegistered = false
        }
        super.onDestroy()
    }

    companion object {
        const val WINDOW_INTERFACE_PROPERTY: String = "SUPAndroid"
        const val WINDOW_PROPERTY_F_DROID: String = "SUPFDroid"
    }
}
