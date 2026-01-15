package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.superproductivity.superproductivity.service.ReminderNotificationHelper

/**
 * Handles reminder snooze action in the background by simply rescheduling the alarm.
 * No app involvement needed - just dismiss notification and schedule new alarm.
 */
class ReminderActionReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "ReminderActionReceiver"
        const val ACTION_SNOOZE = "com.superproductivity.REMINDER_SNOOZE"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_REMINDER_ID = "reminder_id"
        const val EXTRA_RELATED_ID = "related_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_REMINDER_TYPE = "reminder_type"
        const val EXTRA_USE_ALARM_STYLE = "use_alarm_style"

        const val SNOOZE_DURATION_MS = 10 * 60 * 1000L // 10 minutes
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SNOOZE) return

        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val relatedId = intent.getStringExtra(EXTRA_RELATED_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Reminder"
        val reminderType = intent.getStringExtra(EXTRA_REMINDER_TYPE) ?: "TASK"
        val useAlarmStyle = intent.getBooleanExtra(EXTRA_USE_ALARM_STYLE, false)

        Log.d(TAG, "Snooze: notificationId=$notificationId, title=$title")

        // Dismiss the notification
        if (notificationId != -1) {
            NotificationManagerCompat.from(context).cancel(notificationId)
        }

        // Reschedule alarm for 10 minutes from now
        val newTriggerTime = System.currentTimeMillis() + SNOOZE_DURATION_MS
        ReminderNotificationHelper.scheduleReminder(
            context,
            notificationId,
            reminderId,
            relatedId,
            title,
            reminderType,
            newTriggerTime,
            useAlarmStyle
        )

        Log.d(TAG, "Rescheduled reminder for ${SNOOZE_DURATION_MS / 60000} minutes from now")
    }
}
