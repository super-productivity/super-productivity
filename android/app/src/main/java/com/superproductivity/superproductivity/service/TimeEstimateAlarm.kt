package com.superproductivity.superproductivity.service

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R
import com.superproductivity.superproductivity.receiver.TimeEstimateAlarmReceiver

/**
 * The "time estimate exceeded" notice for the tracked task, as the web app
 * hands it over. Title and body arrive already translated.
 */
data class TimeEstimate(
    val taskId: String,
    val timeEstimateMs: Long,
    val title: String,
    val body: String,
)

/**
 * Fires the "time estimate exceeded" notification while the WebView is
 * paused (screen locked, app in the background), where the web app's own check
 * cannot run (#11896). One AlarmManager alarm at a time, owned by
 * [TrackingForegroundService]: it is (re)armed on start/update/estimate change
 * and cancelled whenever tracking ends.
 */
object TimeEstimateAlarm {
    private const val TAG = "TimeEstimateAlarm"
    const val ACTION_TIME_ESTIMATE_EXCEEDED = "com.superproductivity.ACTION_TIME_ESTIMATE_EXCEEDED"
    const val EXTRA_TASK_ID = "task_id"
    const val EXTRA_TIME_ESTIMATE_MS = "time_estimate_ms"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    // Fixed ids: there is only ever one tracked task.
    const val NOTIFICATION_ID = 1005
    private const val REQUEST_CODE = 1005

    /** Matches the web app's throttle between repeated notices while over the estimate. */
    const val REPEAT_INTERVAL_MS = 10 * 60 * 1000L

    // An alarm is never early by more than clock jitter; this only guards
    // against re-notifying from an alarm armed for an older, shorter estimate.
    private const val EARLY_TOLERANCE_MS = 1_000L

    /**
     * When the next notice is due: when tracked time reaches the estimate, but
     * no sooner than [REPEAT_INTERVAL_MS] after the last notice for the same
     * task and estimate. Pure for testing.
     */
    fun nextTriggerAtMs(
        nowMs: Long,
        elapsedMs: Long,
        timeEstimateMs: Long,
        lastNotifiedAtMs: Long?,
    ): Long {
        val reachedAt = nowMs + (timeEstimateMs - elapsedMs).coerceAtLeast(0)
        return if (lastNotifiedAtMs != null) {
            maxOf(reachedAt, lastNotifiedAtMs + REPEAT_INTERVAL_MS)
        } else {
            reachedAt
        }
    }

    fun isReached(elapsedMs: Long, timeEstimateMs: Long): Boolean =
        elapsedMs >= timeEstimateMs - EARLY_TOLERANCE_MS

    fun schedule(context: Context, estimate: TimeEstimate, triggerAtMs: Long) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, TimeEstimateAlarmReceiver::class.java).apply {
            action = ACTION_TIME_ESTIMATE_EXCEEDED
            putExtra(EXTRA_TASK_ID, estimate.taskId)
            putExtra(EXTRA_TIME_ESTIMATE_MS, estimate.timeEstimateMs)
            putExtra(EXTRA_TITLE, estimate.title)
            putExtra(EXTRA_BODY, estimate.body)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                // Same fallback as ReminderNotificationHelper: late, but still
                // delivered in Doze instead of only when the app is reopened.
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
            } else {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
            }
            Log.d(TAG, "Scheduled: taskId=${estimate.taskId}, inMs=${triggerAtMs - System.currentTimeMillis()}")
        } catch (e: RuntimeException) {
            Log.e(TAG, "Failed to schedule time estimate alarm", e)
        }
    }

    fun cancel(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, TimeEstimateAlarmReceiver::class.java).apply {
            action = ACTION_TIME_ESTIMATE_EXCEEDED
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
    }

    fun fromIntent(intent: Intent): TimeEstimate? {
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return null
        val timeEstimateMs = intent.getLongExtra(EXTRA_TIME_ESTIMATE_MS, 0L)
        if (timeEstimateMs <= 0) return null
        return TimeEstimate(
            taskId,
            timeEstimateMs,
            intent.getStringExtra(EXTRA_TITLE) ?: "",
            intent.getStringExtra(EXTRA_BODY) ?: "",
        )
    }

    fun showNotification(context: Context, estimate: TimeEstimate) {
        // Reuses the regular reminder channel: same importance and sound, and
        // the user already controls it under "Reminders".
        ReminderNotificationHelper.createChannels(context)
        val contentIntent = Intent(context, CapacitorMainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            REQUEST_CODE,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(
            context,
            ReminderNotificationHelper.CHANNEL_ID_REGULAR
        )
            .setSmallIcon(R.drawable.ic_stat_sp)
            .setContentTitle(estimate.title)
            .setContentText(estimate.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(estimate.body))
            .setContentIntent(contentPendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.e(TAG, "No permission to show notification", e)
        }
    }
}
