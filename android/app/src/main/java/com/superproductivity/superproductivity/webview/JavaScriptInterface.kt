package com.superproductivity.superproductivity.webview

import android.app.Activity
import android.content.Intent
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.BuildConfig
import com.superproductivity.superproductivity.FullscreenActivity.Companion.WINDOW_INTERFACE_PROPERTY
import com.superproductivity.superproductivity.app.LaunchDecider
import com.superproductivity.superproductivity.service.FocusModeForegroundService
import com.superproductivity.superproductivity.service.ReminderNotificationHelper
import com.superproductivity.superproductivity.service.TrackingForegroundService
import com.superproductivity.superproductivity.widget.WidgetTaskQueue


class JavaScriptInterface(
    private val activity: Activity,
    private val webView: WebView,
) {

    private inline fun safeCall(errorMsg: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.e(TAG, errorMsg, e)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun getVersion(): String {
        val versionName = BuildConfig.VERSION_NAME
        val launchDecider = LaunchDecider(activity)
        val launchMode = launchDecider.getLaunchMode()
        return "${versionName}_L$launchMode"
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
        callJavaScriptFunction(FN_PREFIX + "saveToDbCallback('" + requestId + "')")
    }

    @Suppress("unused")
    @JavascriptInterface
    fun loadFromDb(requestId: String, key: String) {
        val r = (activity.application as App).keyValStore.get(key, "")
        // NOTE: ' are important as otherwise the json messes up
        callJavaScriptFunction(FN_PREFIX + "loadFromDbCallback('" + requestId + "', '" + key + "', '" + r + "')")
    }

    @Suppress("unused")
    @JavascriptInterface
    fun removeFromDb(requestId: String, key: String) {
        (activity.application as App).keyValStore.set(key, null)
        callJavaScriptFunction(FN_PREFIX + "removeFromDbCallback('" + requestId + "')")
    }

    @Suppress("unused")
    @JavascriptInterface
    fun clearDb(requestId: String) {
        (activity.application as App).keyValStore.clearAll(activity)
        callJavaScriptFunction(FN_PREFIX + "clearDbCallback('" + requestId + "')")
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
        safeCall("Failed to start tracking service") {
            val intent = Intent(activity, TrackingForegroundService::class.java).apply {
                action = TrackingForegroundService.ACTION_START
                putExtra(TrackingForegroundService.EXTRA_TASK_ID, taskId)
                putExtra(TrackingForegroundService.EXTRA_TASK_TITLE, taskTitle)
                putExtra(TrackingForegroundService.EXTRA_TIME_SPENT, timeSpentMs)
            }
            ContextCompat.startForegroundService(activity, intent)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun stopTrackingService() {
        safeCall("Failed to stop tracking service") {
            val intent = Intent(activity, TrackingForegroundService::class.java).apply {
                action = TrackingForegroundService.ACTION_STOP
            }
            activity.startService(intent)
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
        safeCall("Failed to start focus mode service") {
            val intent = Intent(activity, FocusModeForegroundService::class.java).apply {
                action = FocusModeForegroundService.ACTION_START
                putExtra(FocusModeForegroundService.EXTRA_TITLE, title)
                putExtra(FocusModeForegroundService.EXTRA_TASK_TITLE, taskTitle)
                putExtra(FocusModeForegroundService.EXTRA_DURATION_MS, durationMs)
                putExtra(FocusModeForegroundService.EXTRA_REMAINING_MS, remainingMs)
                putExtra(FocusModeForegroundService.EXTRA_IS_BREAK, isBreak)
                putExtra(FocusModeForegroundService.EXTRA_IS_PAUSED, isPaused)
            }
            ContextCompat.startForegroundService(activity, intent)
        }
    }

    @Suppress("unused")
    @JavascriptInterface
    fun stopFocusModeService() {
        safeCall("Failed to stop focus mode service") {
            val intent = Intent(activity, FocusModeForegroundService::class.java).apply {
                action = FocusModeForegroundService.ACTION_STOP
            }
            activity.startService(intent)
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

    @Suppress("unused")
    @JavascriptInterface
    fun scheduleNativeReminder(
        notificationId: Int,
        reminderId: String,
        relatedId: String,
        title: String,
        reminderType: String,
        triggerAtMs: Long,
        useAlarmStyle: Boolean
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
                useAlarmStyle
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

    fun callJavaScriptFunction(script: String) {
        webView.post { webView.evaluateJavascript(script) { } }
    }

    companion object {
        private const val TAG = "JavaScriptInterface"
        // TODO rename to WINDOW_PROPERTY
        const val FN_PREFIX: String = "window.$WINDOW_INTERFACE_PROPERTY."
    }
}
