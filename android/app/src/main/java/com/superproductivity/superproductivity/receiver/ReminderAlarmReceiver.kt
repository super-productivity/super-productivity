package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.superproductivity.superproductivity.service.ReminderNotificationHelper

/**
 * Receives alarm broadcasts and shows reminder notifications.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "ReminderAlarmReceiver"
        const val ACTION_SHOW_REMINDER = "com.superproductivity.ACTION_SHOW_REMINDER"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_REMINDER_ID = "reminder_id"
        const val EXTRA_RELATED_ID = "related_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_REMINDER_TYPE = "reminder_type"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SHOW_REMINDER) return

        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val relatedId = intent.getStringExtra(EXTRA_RELATED_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Reminder"
        val reminderType = intent.getStringExtra(EXTRA_REMINDER_TYPE) ?: "TASK"

        Log.d(TAG, "Alarm triggered: id=$notificationId, title=$title")

        ReminderNotificationHelper.showNotification(
            context,
            notificationId,
            reminderId,
            relatedId,
            title,
            reminderType
        )
    }
}
