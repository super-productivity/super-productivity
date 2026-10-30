package com.superproductivity.superproductivity.receiver

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.superproductivity.superproductivity.service.FocusModeForegroundService
import com.superproductivity.superproductivity.service.FocusModeNotificationHelper
import com.superproductivity.superproductivity.service.TrackingForegroundService
import com.superproductivity.superproductivity.widget.NotificationActionQueue

/**
 * Handles the tracking (Pause/Done) and focus-mode (Pause/Resume/Skip/Complete)
 * notification buttons without bringing the app to the foreground (#10683).
 *
 * These used to be Activity PendingIntents forwarded to JS by push, which was
 * silently dropped whenever the WebView wasn't ready — e.g. after a swipe-away
 * while the foreground service kept running (#7818). Now each tap:
 *  1. is applied natively right away (tracking: sample the task total and stop
 *     the service; focus: freeze the countdown and task clock), so no time
 *     accrues after the tap even if the app is never opened, and
 *  2. is persisted in [NotificationActionQueue]; Angular drains it on startup,
 *     resume and on the [ACTION_DRAIN] signal sent to a live activity.
 */
class NotificationActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "NotificationAction"

        /** Contentless "drain now" signal for a live activity (LocalBroadcast). */
        const val ACTION_DRAIN = "com.superproductivity.superproductivity.NOTIFICATION_ACTION_DRAIN"

        fun pendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, NotificationActionReceiver::class.java).apply {
                this.action = action
            }
            return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        /** Returns true if [action] is one of ours (also used for legacy Activity intents). */
        fun handle(context: Context, action: String?): Boolean {
            when (action) {
                TrackingForegroundService.ACTION_PAUSE ->
                    handleTracking(context, NotificationActionQueue.TRACKING_PAUSE)
                TrackingForegroundService.ACTION_DONE ->
                    handleTracking(context, NotificationActionQueue.TRACKING_DONE)
                FocusModeForegroundService.ACTION_PAUSE ->
                    handleFocus(context, NotificationActionQueue.FOCUS_PAUSE, pauseNative = true)
                FocusModeForegroundService.ACTION_RESUME ->
                    handleFocus(context, NotificationActionQueue.FOCUS_RESUME, pauseNative = false)
                FocusModeForegroundService.ACTION_SKIP -> {
                    FocusModeNotificationHelper.cancelCompletionNotification(context)
                    // Freeze the break so it can't complete (and alert) before
                    // the app applies the skip.
                    handleFocus(context, NotificationActionQueue.FOCUS_SKIP, pauseNative = true)
                }
                FocusModeForegroundService.ACTION_COMPLETE -> {
                    FocusModeNotificationHelper.cancelCompletionNotification(context)
                    // Freeze the session so the time after the tap isn't counted.
                    handleFocus(context, NotificationActionQueue.FOCUS_COMPLETE, pauseNative = true)
                }
                else -> return false
            }
            LocalBroadcastManager.getInstance(context).sendBroadcast(Intent(ACTION_DRAIN))
            return true
        }

        private fun handleTracking(context: Context, type: String) {
            val snapshot = TrackingForegroundService.takeForNotificationAction(context)
            if (snapshot == null) {
                // Stale notification: nothing is tracked natively, so there is
                // neither time to credit nor a task to act on.
                // Don't stop anything either: a start may be in flight.
                Log.d(TAG, "Tracking $type ignored - not tracking")
                return
            }
            Log.d(TAG, "Tracking $type: taskId=${snapshot.taskId}")
            NotificationActionQueue.addTrackingAction(
                context,
                type,
                snapshot.taskId,
                snapshot.elapsedMs,
                snapshot.at
            )
            TrackingForegroundService.requestStop(context)
        }

        private fun handleFocus(context: Context, type: String, pauseNative: Boolean) {
            Log.d(TAG, "Focus $type")
            NotificationActionQueue.addFocusAction(context, type, System.currentTimeMillis())
            if (!FocusModeForegroundService.isRunning) return
            if (pauseNative == FocusModeForegroundService.isPaused) return
            val intent = Intent(context, FocusModeForegroundService::class.java).apply {
                action = if (pauseNative) {
                    FocusModeForegroundService.ACTION_PAUSE
                } else {
                    FocusModeForegroundService.ACTION_RESUME
                }
            }
            try {
                // The service is already in the foreground, and a notification
                // action grants a temporary allowlist, so startService() is allowed.
                context.startService(intent)
            } catch (e: RuntimeException) {
                // The queued action still reaches Angular; only the immediate
                // native freeze is lost.
                Log.w(TAG, "Failed to apply focus $type natively", e)
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        handle(context, intent.action)
    }
}
