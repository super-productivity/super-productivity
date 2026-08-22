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
import android.view.ViewGroup
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
import com.superproductivity.superproductivity.webview.ImeWebViewHeight
import com.superproductivity.superproductivity.webview.JavaScriptInterface
import com.superproductivity.superproductivity.webview.NativeInsetShimGate
import com.superproductivity.superproductivity.webview.WebHelper
import com.superproductivity.superproductivity.webview.WebViewBlockActivity
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker
import com.superproductivity.superproductivity.webview.WebViewRecovery
import com.superproductivity.superproductivity.widget.ShareIntentQueue
import com.superproductivity.superproductivity.widget.StartupOverlayManager
import com.superproductivity.superproductivity.widget.TaskListWidgetProvider
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

    // Soft-keyboard workaround: the WebView's resting layout height
    // (e.g. MATCH_PARENT), captured so it can be restored when the keyboard hides.
    // See adjustWebViewHeightForKeyboard.
    private var webViewLayoutHeightDefault: Int? = null

    // Reused scratch for getLocationOnScreen in the keyboard layout listener (hot
    // path) to avoid allocating an IntArray on every pass while the IME is up.
    private val webViewLocationOnScreen = IntArray(2)

    // Status-bar overlap workaround: last value pushed to JS, to dedupe the
    // per-layout-pass listener. -1 = nothing pushed yet.
    // See pushStatusBarOverlap.
    private var lastStatusBarOverlapCssPx: Int = -1

    // Last IME state the geometry diagnostic logged, so the per-layout-pass
    // listener logs once per transition instead of every pass. null = nothing yet.
    // See logImeGeometryOnTransition.
    private var lastLoggedKeyboardOpen: Boolean? = null

    private var isTimerCompleteReceiverRegistered = false
    private var isForegroundServiceFailureReceiverRegistered = false
    private var isWidgetDoneDrainReceiverRegistered = false

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

    private val widgetDoneDrainReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == TaskListWidgetProvider.ACTION_WIDGET_DONE_DRAIN) {
                // Contentless drain signal: Angular pulls the queued IDs itself via
                // getWidgetDoneQueue(), so there is a single delivery path and no
                // task data crosses the string-interpolated JS bridge.
                callJSInterfaceFunctionIfExists("next", "onWidgetDoneDrainRequest$")
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


        // Remember the WebView's resting layout height (e.g. MATCH_PARENT) so the
        // keyboard workaround can restore it on hide. See
        // adjustWebViewHeightForKeyboard.
        webViewLayoutHeightDefault = bridge?.webView?.layoutParams?.height

        // Handle keyboard visibility changes
        val rootView = findViewById<View>(android.R.id.content)
        rootView.viewTreeObserver.addOnGlobalLayoutListener {
            val rect = Rect()
            rootView.getWindowVisibleDisplayFrame(rect)
            val screenHeight = rootView.rootView.height

            val keypadHeight = screenHeight - rect.bottom
            val isKeyboardOpen = keypadHeight > screenHeight * 0.15
            callJSInterfaceFunctionIfExists(
                "next",
                "isKeyboardShown$",
                if (isKeyboardOpen) "true" else "false"
            )
            adjustWebViewHeightForKeyboard(rect, isKeyboardOpen)
            pushStatusBarOverlap(rect)
            // After the shim, so the log shows the height it applied. See
            // logImeGeometryOnTransition.
            logImeGeometryOnTransition(rect, isKeyboardOpen)
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
        LocalBroadcastManager.getInstance(this).registerReceiver(
            widgetDoneDrainReceiver,
            IntentFilter(TaskListWidgetProvider.ACTION_WIDGET_DONE_DRAIN)
        )
        isWidgetDoneDrainReceiverRegistered = true

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
        // The block screen no longer shows the pre-flight version (it is misleading on
        // this path), so log it — otherwise a user report carries no trace of it at all.
        Log.w("CapacitorMainActivity", "WebView init failure preflight: $webViewCompatibility")
        webViewBlocked = true
        WebViewBlockActivity.present(
            this,
            WebViewCompatibilityChecker.initFailureResult(webViewCompatibility),
        )
        finish()
    }

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
        // A web-side reload (e.g. language change, PWA update, sync-conflict
        // recovery — all do window.location.reload()) re-runs the bundle and
        // re-enters here, but it also wipes the inline --android-status-bar-overlap
        // off the fresh document. Re-arm the dedupe so the next layout pass
        // re-publishes it; otherwise the unchanged value is skipped and the
        // header overlaps the status bar again on the WebView < 140 / API < 35
        // tail. See pushStatusBarOverlap.
        lastStatusBarOverlapCssPx = -1
        pendingShareIntent?.let {
            Log.d("SP_SHARE", "Flushing pending share intent")
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
                // Shape only, never the content: logcat is world-readable to adb and
                // ends up in bug reports, and this carries whatever the user shared.
                Log.d(
                    "SP_SHARE",
                    "Received share: textLen=${sharedText?.length ?: 0} " +
                        "hasTitle=${sharedTitle.isNotEmpty()} hasSubject=${sharedSubject.isNotEmpty()}",
                )

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
                        Log.d("SP_SHARE", "Frontend ready, sending directly (type=$type)")
                        callJSInterfaceFunctionIfExists("next", "onShareWithAttachment$", json.toString())
                        pendingShareIntent = null
                        ShareIntentQueue.getAndClear(this)
                    } else {
                        Log.d("SP_SHARE", "Frontend NOT ready, queueing (type=$type)")
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

    /**
     * Whether Capacitor's SystemBars leaves the insets unowned on this device, so
     * our native shims below have to step in. See [NativeInsetShimGate].
     */
    private fun shouldRunNativeInsetShim(): Boolean =
        NativeInsetShimGate.shouldRunShim(
            sdkInt = android.os.Build.VERSION.SDK_INT,
            webViewMajor = NativeInsetShimGate.activeProviderMajor(webViewCompatibility),
        )

    /**
     * One-line IME geometry diagnostic, logged once per keyboard transition.
     *
     * #9316 can only be settled on a reporter's device, and the shim is a strict
     * no-op wherever the window already resizes for the IME — so "the bar looks
     * fixed" cannot by itself tell a working shim from one that never ran. This
     * prints the gate's inputs next to the geometry it decides from, so a test
     * build gives an unambiguous answer.
     *
     * Must be called **after** the shim has had its pass, so `paramsHeight` is
     * what the shim just applied rather than the value it replaced. `target` is
     * recomputed here from the same input, so a pass where the shim bailed on a
     * degenerate frame still reads unambiguously (`target` set, `paramsHeight`
     * unchanged) instead of looking like the gate was off. `webViewHeight` is
     * still the pre-layout measurement — it catches up on the next pass.
     *
     * Silent unless explicitly enabled (`adb shell setprop log.tag.SUPKeyboard
     * DEBUG`), so release builds stay quiet; the transition check comes first to
     * keep the per-layout-pass listener cheap. Geometry and versions only — never
     * user content.
     */
    private fun logImeGeometryOnTransition(rect: Rect, isKeyboardOpen: Boolean) {
        if (lastLoggedKeyboardOpen == isKeyboardOpen) return
        lastLoggedKeyboardOpen = isKeyboardOpen
        if (!Log.isLoggable("SUPKeyboard", Log.DEBUG)) return
        val webView = bridge?.webView ?: return
        webView.getLocationOnScreen(webViewLocationOnScreen)
        Log.d(
            "SUPKeyboard",
            "ime=$isKeyboardOpen shim=${shouldRunNativeInsetShim()} " +
                "sdk=${android.os.Build.VERSION.SDK_INT} " +
                "wvMajor=${NativeInsetShimGate.activeProviderMajor(webViewCompatibility)} " +
                "(raw=${webViewCompatibility?.majorVersion} src=${webViewCompatibility?.source}) " +
                "rectBottom=${rect.bottom} webViewTop=${webViewLocationOnScreen[1]} " +
                "target=${
                    ImeWebViewHeight.targetHeight(rect.bottom, webViewLocationOnScreen[1])
                } " +
                "webViewHeight=${webView.height} paramsHeight=${webView.layoutParams?.height}"
        )
    }

    /**
     * Soft-keyboard fallback for the add-task bar sitting behind the keyboard
     * (#8508 follow-up on Android 9 / API 28; #9316 on API 34 + WebView 124/126).
     *
     * Context: Android edge-to-edge inset handling is owned by Capacitor's
     * built-in SystemBars now (the `@capawesome` edge-to-edge plugin was removed).
     * SystemBars only pads the WebView for the IME on **WebView >= 140**
     * (passthrough) or **API >= 35**; outside that it applies nothing, the window
     * does NOT resize for the IME, and the `position: fixed` add-task bar sits
     * behind the keyboard. This shim covers exactly that gap — see
     * [NativeInsetShimGate] for why the gate is the complement of SystemBars'
     * two ownership branches, so the two never double-count.
     *
     * We must NOT correct this via `bottomMargin` or `padding` (a margin writer
     * fights whatever owns the insets, and WebView padding does not move the web
     * layout viewport). Instead, while the keyboard is up we set an explicit
     * WebView **layout height** (to the keyboard top) and restore the resting
     * height ([webViewLayoutHeightDefault], e.g. MATCH_PARENT) on hide. Shrinking
     * the view shrinks the web layout viewport, so the existing CSS resolves the
     * bar above the keyboard with no web-side keyboard-height math (avoiding the
     * reverted #8295 fallback). The target (`rect.bottom − webViewTop`) is read
     * from `getWindowVisibleDisplayFrame` and does not depend on the WebView's
     * own height, so it is stable across passes — no feedback loop.
     *
     * That absolute target is also what makes this **resize-detecting**, the
     * hard requirement #8508 left behind: on a device where the window already
     * shrank for the IME, the WebView bottom is already at `rect.bottom`, so the
     * computed height equals the current one and nothing moves. It cannot
     * re-create the squashed-WebView regression the way the reverted delta-based
     * inset did. See docs/android-edge-to-edge-keyboard.md and
     * docs/plans/2026-06-22-android-systembars-migration-corrected.md.
     */
    private fun adjustWebViewHeightForKeyboard(rect: Rect, isKeyboardOpen: Boolean) {
        if (!shouldRunNativeInsetShim()) return
        val webView = bridge?.webView ?: return
        val params = webView.layoutParams ?: return
        // Ignore stale/pre-layout geometry so the height is not set from a bad frame.
        if (isKeyboardOpen && webView.height == 0) return

        val targetHeight: Int
        if (isKeyboardOpen) {
            webView.getLocationOnScreen(webViewLocationOnScreen)
            // Absolute target, never a delta — see ImeWebViewHeight for why that is
            // what keeps this from re-creating #8508. null = degenerate/transient
            // frame; keep the current height until a sane value appears, or the
            // height==0 check above would latch and stop recomputing.
            targetHeight = ImeWebViewHeight.targetHeight(
                rectBottom = rect.bottom,
                webViewTop = webViewLocationOnScreen[1],
            ) ?: return
        } else {
            targetHeight = webViewLayoutHeightDefault ?: ViewGroup.LayoutParams.MATCH_PARENT
        }

        if (params.height == targetHeight) return
        params.height = targetHeight
        webView.layoutParams = params
        if (BuildConfig.DEBUG) {
            Log.d(
                "SUPKeyboard",
                "webView height -> $targetHeight (kbOpen=$isKeyboardOpen rectB=${rect.bottom})"
            )
        }
    }

    /**
     * Status-bar overlap workaround for the web header drawing BEHIND the status
     * bar on the WebView < 140 tail (#8508 / #8283 follow-up, Android 9 / API 28;
     * reads 0 and self-disables where the WebView is already inset).
     *
     * Edge-to-edge insets are owned by Capacitor's built-in SystemBars now. On
     * **API >= 35** it injects the real `--safe-area-inset-*` px, and on
     * **WebView >= 140** the WebView's own `env(safe-area-inset-*)` is correct
     * (passthrough). But on the **WebView < 140** tail under enforced edge-to-edge
     * the WebView extends under the status bar while `env(safe-area-inset-top)`
     * resolves to 0 (old WebViews map only display cutouts into safe-area insets,
     * not the status bar) — so the web side has no top inset and content overlaps
     * the status bar.
     *
     * We measure the overlap natively and publish it as the `--android-status-bar-
     * overlap` CSS var, which the web side folds into `--safe-area-top` via
     * `var(--safe-area-inset-top, max(env(...), var(--android-status-bar-overlap)))`.
     * The overlap is how much of the status bar covers the WebView: `rect.top`
     * (top of the visible display frame = status-bar height, reliable on API 28,
     * the same frame the keyboard path uses) minus the WebView's top on screen
     * (`getLocationOnScreen`: 0 when edge-to-edge, == status-bar height once
     * inset). So it is the status-bar height when the WebView is NOT inset and 0
     * once it is — `max()` never double-counts. Physical px → CSS px via display
     * density; deduped so the per-layout listener does not spam evaluateJavascript.
     *
     * Shares [NativeInsetShimGate] with the keyboard shim so it never fights
     * SystemBars; on API >= 35 the injected --safe-area-inset-top wins via var()
     * precedence and the published var is ignored regardless.
     */
    private fun pushStatusBarOverlap(rect: Rect) {
        if (!shouldRunNativeInsetShim()) return
        if (!::javaScriptInterface.isInitialized) return
        val webView = bridge?.webView ?: return
        webView.getLocationOnScreen(webViewLocationOnScreen)
        val overlapPx = (rect.top - webViewLocationOnScreen[1]).coerceAtLeast(0)
        val density = resources.displayMetrics.density
        val overlapCssPx = if (density > 0f) Math.round(overlapPx / density) else overlapPx
        if (overlapCssPx == lastStatusBarOverlapCssPx) return
        lastStatusBarOverlapCssPx = overlapCssPx
        javaScriptInterface.callJavaScriptFunction(
            "document.documentElement.style.setProperty(" +
                "'--android-status-bar-overlap','${overlapCssPx}px')"
        )
        if (BuildConfig.DEBUG) {
            Log.d(
                "SUPKeyboard",
                "statusBarOverlap -> ${overlapCssPx}px (rectTop=${rect.top} wvTop=${webViewLocationOnScreen[1]})"
            )
        }
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
        if (isWidgetDoneDrainReceiverRegistered) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(widgetDoneDrainReceiver)
            isWidgetDoneDrainReceiverRegistered = false
        }
        super.onDestroy()
    }

    companion object {
        const val WINDOW_INTERFACE_PROPERTY: String = "SUPAndroid"
        const val WINDOW_PROPERTY_F_DROID: String = "SUPFDroid"
    }
}
