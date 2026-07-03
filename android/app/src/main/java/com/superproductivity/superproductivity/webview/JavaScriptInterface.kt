package com.superproductivity.superproductivity.webview

import android.app.Activity
import android.app.ForegroundServiceStartNotAllowedException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.BuildConfig
import com.superproductivity.superproductivity.FullscreenActivity.Companion.WINDOW_INTERFACE_PROPERTY
import com.superproductivity.superproductivity.app.LaunchDecider
import com.superproductivity.superproductivity.review.InAppReview
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.service.FocusModeForegroundService
import com.superproductivity.superproductivity.service.ForegroundServiceFailure
import com.superproductivity.superproductivity.service.ReminderNotificationHelper
import com.superproductivity.superproductivity.service.SyncReminderScheduler
import com.superproductivity.superproductivity.service.TrackingForegroundService
import com.superproductivity.superproductivity.widget.ReminderDoneQueue
import com.superproductivity.superproductivity.widget.ReminderSnoozeQueue
import com.superproductivity.superproductivity.widget.ReminderTapQueue
import com.superproductivity.superproductivity.widget.ShareIntentQueue
import com.superproductivity.superproductivity.widget.TaskListWidgetProvider
import com.superproductivity.superproductivity.widget.WidgetDoneQueue
import com.superproductivity.superproductivity.widget.WidgetTaskQueue
import org.json.JSONObject


class JavaScriptInterface(
    private val activity: Activity,
    private val webView: WebView,
) {

    private inline fun safeCall(
        errorMsg: String,
        foregroundService: String? = null,
        block: () -> Unit
    ) {
        try {
            block()
        } catch (e: Exception) {
            val isStartNotAllowed =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    e is ForegroundServiceStartNotAllowedException
            if (isStartNotAllowed) {
                Log.e(TAG, "$errorMsg - ForegroundService restrictions violated (Android 12+). App may be in background.", e)
            } else {
                Log.e(TAG, errorMsg, e)
            }
            foregroundService?.let {
                emitForegroundServiceStartFailed(
                    it,
                    if (isStartNotAllowed) {
                        ForegroundServiceFailure.REASON_START_NOT_ALLOWED
                    } else {
                        ForegroundServiceFailure.REASON_PROMOTION_FAILED
                    }
                )
            }
        }
    }

    private fun emitForegroundServiceStartFailed(service: String, reason: String) {
        val payload = "{service:${JSONObject.quote(service)},reason:${JSONObject.quote(reason)}}"
        val subjectPath = "${FN_PREFIX}onForegroundServiceStartFailed${'$'}"
        callJavaScriptFunction(
            "if(window.$WINDOW_INTERFACE_PROPERTY && " +
                "$subjectPath) " +
                "$subjectPath.next($payload)"
        )
    }

    @Suppress("unused")
    @JavascriptInterface
    fun getVersion(): String {
        val versionName = BuildConfig.VERSION_NAME
        val launchDecider = LaunchDecider(activity)
        val launchMode = launchDecider.getLaunchMode()
        return "${versionName}_L$launchMode"
    }

    // Launch the Play In-App Review flow (play flavor). Delegates to a
    // flavor-specific InAppReview: the real Play Core implementation in src/play,
    // and a no-op stub in src/fdroid so the proprietary library stays out of the
    // F-Droid build. Play controls whether/when the card actually shows.
    @Suppress("unused")
    @JavascriptInterface
    fun requestReview() {
        activity.runOnUiThread {
            InAppReview.request(activity)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun showToast(toast: String) {
        Toast.makeText(activity, toast, Toast.LENGTH_SHORT).show()
    }


    @Suppress("unused")
    @JavascriptInterface
    fun saveToDb(requestId: String, key: String, value: String) {
        (activity.application as App).keyValStore.set(key, value)
        callJavaScriptFunction(FN_PREFIX + "saveToDbCallback(" + JSONObject.quote(requestId) + ")")
    }

    // #7925: quote every arg so a stored value with ' / \ / newlines / </script>
    // can't break out of the JS literal. (JSON.stringify does not escape
    // apostrophes — pre-fix, a backup blob with one silently corrupted the load.)
    @Suppress("unused")
    @JavascriptInterface
    fun loadFromDb(requestId: String, key: String) {
        val r = (activity.application as App).keyValStore.get(key, "")
        callJavaScriptFunction(
            FN_PREFIX + "loadFromDbCallback(" +
                JSONObject.quote(requestId) + ", " +
                JSONObject.quote(key) + ", " +
                JSONObject.quote(r) + ")"
        )
    }

    @Suppress("unused")
    @JavascriptInterface
    fun removeFromDb(requestId: String, key: String) {
        (activity.application as App).keyValStore.set(key, null)
        callJavaScriptFunction(FN_PREFIX + "removeFromDbCallback(" + JSONObject.quote(requestId) + ")")
    }

    @Suppress("unused")
    @JavascriptInterface
    fun clearDb(requestId: String) {
        (activity.application as App).keyValStore.clearAll(activity)
        callJavaScriptFunction(FN_PREFIX + "clearDbCallback(" + JSONObject.quote(requestId) + ")")
    }

    @Suppress("unused")
    @JavascriptInterface
    fun triggerGetShareData() {
        if (activity is com.superproductivity.superproductivity.CapacitorMainActivity) {
            activity.runOnUiThread {
                activity.flushPendingShareIntent()
            }
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun startTrackingService(taskId: String, taskTitle: String, timeSpentMs: Long) {
        safeCall(
            "Failed to start tracking service",
            ForegroundServiceFailure.SERVICE_TRACKING
        ) {
            val intent = Intent(activity, TrackingForegroundService::class.java).apply {
                action = TrackingForegroundService.ACTION_START
                putExtra(TrackingForegroundService.EXTRA_TASK_ID, taskId)
                putExtra(TrackingForegroundService.EXTRA_TASK_TITLE, taskTitle)
                putExtra(TrackingForegroundService.EXTRA_TIME_SPENT, timeSpentMs)
            }
            TrackingForegroundService.markStartPending()
            try {
                ContextCompat.startForegroundService(activity, intent)
            } catch (e: Exception) {
                TrackingForegroundService.clearStartPending()
                throw e
            }
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun stopTrackingService() {
        safeCall("Failed to stop tracking service") {
            val intent = Intent(activity, TrackingForegroundService::class.java)
            if (TrackingForegroundService.isStartPending || TrackingForegroundService.isTracking) {
                // A startForegroundService() may still be promoting: stopping via
                // stopService() now could tear it down before startForeground()
                // runs and crash with ForegroundServiceDidNotStartInTimeException.
                // Routing as ACTION_STOP through onStartCommand lets it promote
                // first, then stop cleanly.
                intent.action = TrackingForegroundService.ACTION_STOP
                try {
                    activity.startService(intent)
                } catch (e: IllegalStateException) {
                    // App is in the background: startService() is disallowed here.
                    // Only fall back to stopService() if no start is still pending
                    // — stopping a not-yet-promoted service would re-trigger the
                    // same crash. If a start IS pending, leave it: the pending
                    // start promotes and a later foreground sync stops it cleanly.
                    Log.d(TAG, "stopTrackingService: app backgrounded, falling back to stopService()", e)
                    if (!TrackingForegroundService.isStartPending) {
                        activity.stopService(Intent(activity, TrackingForegroundService::class.java))
                    }
                }
            } else {
                activity.stopService(intent)
            }
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun updateTrackingService(timeSpentMs: Long) {
        safeCall("Failed to update tracking service") {
            val intent = Intent(activity, TrackingForegroundService::class.java).apply {
                action = TrackingForegroundService.ACTION_UPDATE
                putExtra(TrackingForegroundService.EXTRA_TIME_SPENT, timeSpentMs)
            }
            activity.startService(intent)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun getTrackingElapsed(): String {
        val taskId = TrackingForegroundService.currentTaskId
        val elapsedMs = TrackingForegroundService.getElapsedMs()
        val isTracking = TrackingForegroundService.isTracking
        return if (isTracking && taskId != null) {
            """{"taskId":"$taskId","elapsedMs":$elapsedMs}"""
        } else {
            "null"
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun startFocusModeService(
        title: String,
        durationMs: Long,
        remainingMs: Long,
        isBreak: Boolean,
        isPaused: Boolean,
        taskTitle: String?
    ) {
        safeCall(
            "Failed to start focus mode service",
            ForegroundServiceFailure.SERVICE_FOCUS_MODE
        ) {
            val intent = Intent(activity, FocusModeForegroundService::class.java).apply {
                action = FocusModeForegroundService.ACTION_START
                putExtra(FocusModeForegroundService.EXTRA_TITLE, title)
                putExtra(FocusModeForegroundService.EXTRA_TASK_TITLE, taskTitle)
                putExtra(FocusModeForegroundService.EXTRA_DURATION_MS, durationMs)
                putExtra(FocusModeForegroundService.EXTRA_REMAINING_MS, remainingMs)
                putExtra(FocusModeForegroundService.EXTRA_IS_BREAK, isBreak)
                putExtra(FocusModeForegroundService.EXTRA_IS_PAUSED, isPaused)
            }
            FocusModeForegroundService.markStartPending()
            try {
                ContextCompat.startForegroundService(activity, intent)
            } catch (e: Exception) {
                FocusModeForegroundService.clearStartPending()
                throw e
            }
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun stopFocusModeService() {
        safeCall("Failed to stop focus mode service") {
            val intent = Intent(activity, FocusModeForegroundService::class.java)
            if (FocusModeForegroundService.isStartPending || FocusModeForegroundService.isRunning) {
                // A startForegroundService() may still be promoting: stopping via
                // stopService() now could tear it down before startForeground()
                // runs and crash with ForegroundServiceDidNotStartInTimeException.
                // Routing as ACTION_STOP through onStartCommand lets it promote
                // first, then stop cleanly.
                intent.action = FocusModeForegroundService.ACTION_STOP
                try {
                    activity.startService(intent)
                } catch (e: IllegalStateException) {
                    // App is in the background: startService() is disallowed here.
                    // Only fall back to stopService() if no start is still pending
                    // — stopping a not-yet-promoted service would re-trigger the
                    // same crash. If a start IS pending, leave it: the pending
                    // start promotes and a later foreground sync stops it cleanly.
                    Log.d(TAG, "stopFocusModeService: app backgrounded, falling back to stopService()", e)
                    if (!FocusModeForegroundService.isStartPending) {
                        activity.stopService(Intent(activity, FocusModeForegroundService::class.java))
                    }
                }
            } else {
                activity.stopService(intent)
            }
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun updateFocusModeService(title: String, remainingMs: Long, isPaused: Boolean, isBreak: Boolean, taskTitle: String?) {
        safeCall("Failed to update focus mode service") {
            val intent = Intent(activity, FocusModeForegroundService::class.java).apply {
                action = FocusModeForegroundService.ACTION_UPDATE
                putExtra(FocusModeForegroundService.EXTRA_TITLE, title)
                putExtra(FocusModeForegroundService.EXTRA_REMAINING_MS, remainingMs)
                putExtra(FocusModeForegroundService.EXTRA_IS_PAUSED, isPaused)
                putExtra(FocusModeForegroundService.EXTRA_IS_BREAK, isBreak)
                putExtra(FocusModeForegroundService.EXTRA_TASK_TITLE, taskTitle)
            }
            activity.startService(intent)
        }
    }

    /**
     * Read back the live focus-mode session so the WebView can recover it after
     * being recreated (app reopened from recents). Returns "null" when no focus
     * session is running. Intentionally omits the task title — no user content
     * crosses the bridge here; the Angular store re-derives it (#7855).
     */
    @Suppress("unused")
    @JavascriptInterface
    fun getFocusModeElapsed(): String {
        return if (FocusModeForegroundService.isRunning) {
            val durationMs = FocusModeForegroundService.durationMs
            val remainingMs = FocusModeForegroundService.liveRemainingMs()
            val isBreak = FocusModeForegroundService.isBreak
            val isPaused = FocusModeForegroundService.isPaused
            """{"durationMs":$durationMs,"remainingMs":$remainingMs,"isBreak":$isBreak,"isPaused":$isPaused}"""
        } else {
            "null"
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun scheduleNativeReminder(
        notificationId: Int,
        reminderId: String,
        relatedId: String,
        title: String,
        reminderType: String,
        triggerAtMs: Long,
        useAlarmStyle: Boolean,
        isOngoing: Boolean
    ) {
        safeCall("Failed to schedule native reminder") {
            ReminderNotificationHelper.scheduleReminder(
                activity,
                notificationId,
                reminderId,
                relatedId,
                title,
                reminderType,
                triggerAtMs,
                useAlarmStyle,
                isOngoing
            )
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun cancelNativeReminder(notificationId: Int) {
        safeCall("Failed to cancel native reminder") {
            ReminderNotificationHelper.cancelReminder(activity, notificationId)
        }
    }

    /**
     * Get queued tasks from the widget and clear the queue.
     * Returns JSON string of tasks or null if empty.
     */
    @Suppress("unused")
    @JavascriptInterface
    fun getWidgetTaskQueue(): String? {
        return WidgetTaskQueue.getAndClearQueue(activity)
    }

    /**
     * Get pending done-state changes from the home screen widget and clear the
     * queue. Returns a JSON object string `{taskId: targetIsDone}` or null if empty.
     */
    @Suppress("unused")
    @JavascriptInterface
    fun getWidgetDoneQueue(): String? {
        return WidgetDoneQueue.getAndClear(activity)
    }

    /**
     * Re-render the home screen widget from the current `widget_data` KeyValStore
     * snapshot. Called by Angular after each snapshot push.
     */
    @Suppress("unused")
    @JavascriptInterface
    fun updateWidget() {
        TaskListWidgetProvider.notifyDataChanged(activity)
    }

    /**
     * Pull-based retrieval of pending share data persisted in SharedPreferences.
     * Clears both SharedPreferences and in-memory pendingShareIntent to prevent duplicates.
     * @return JSON string of share data, or null if none pending
     */
    @Suppress("unused")
    @JavascriptInterface
    fun getPendingShareData(): String? {
        val data = ShareIntentQueue.getAndClear(activity)
        if (activity is com.superproductivity.superproductivity.CapacitorMainActivity) {
            activity.runOnUiThread {
                activity.clearPendingShareIntent()
            }
        }
        return data
    }

    @Suppress("unused")
    @JavascriptInterface
    fun getReminderTapQueue(): String? {
        return ReminderTapQueue.getAndClear(activity)
    }

    @Suppress("unused")
    @JavascriptInterface
    fun getReminderDoneQueue(): String? {
        return ReminderDoneQueue.getAndClear(activity)
    }

    @Suppress("unused")
    @JavascriptInterface
    fun getReminderSnoozeQueue(): String? {
        return ReminderSnoozeQueue.getAndClear(activity)
    }

    /**
     * Phase 1: Get partial text from the startup overlay without hiding it.
     * The native input stays visible so the user sees a seamless transition.
     */
    @Suppress("unused")
    @JavascriptInterface
    fun getStartupOverlayPartialText(): String? {
        var partialText: String? = null
        if (activity is com.superproductivity.superproductivity.CapacitorMainActivity) {
            val latch = java.util.concurrent.CountDownLatch(1)
            activity.runOnUiThread {
                partialText = activity.getStartupOverlayPartialText()
                latch.countDown()
            }
            latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        }
        return partialText
    }

    /**
     * Phase 2: Hide the startup overlay after the web input is ready.
     */
    @Suppress("unused")
    @JavascriptInterface
    fun hideStartupOverlay() {
        if (activity is com.superproductivity.superproductivity.CapacitorMainActivity) {
            activity.runOnUiThread {
                activity.hideStartupOverlay()
            }
        }
    }

    /**
     * Dismiss startup overlay immediately (no partial text transfer).
     */
    @Suppress("unused")
    @JavascriptInterface
    fun dismissStartupOverlay() {
        if (activity is com.superproductivity.superproductivity.CapacitorMainActivity) {
            activity.runOnUiThread {
                activity.dismissStartupOverlay()
            }
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun setSuperSyncCredentials(baseUrl: String, accessToken: String) {
        safeCall("Failed to set SuperSync credentials") {
            BackgroundSyncCredentialStore.save(activity, baseUrl, accessToken)
            SyncReminderScheduler.ensureScheduled(activity)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun clearSuperSyncCredentials() {
        safeCall("Failed to clear SuperSync credentials") {
            BackgroundSyncCredentialStore.clear(activity)
            SyncReminderScheduler.cancel(activity)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun openAppNotificationSettings() {
        safeCall("Failed to open notification settings") {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                }
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${activity.packageName}")
                }
            }
            activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    fun callJavaScriptFunction(script: String) {
        webView.post { webView.evaluateJavascript(script) { } }
    }

    companion object {
        private const val TAG = "JavaScriptInterface"
        // TODO rename to WINDOW_PROPERTY
        const val FN_PREFIX: String = "window.$WINDOW_INTERFACE_PROPERTY."
    }
}
