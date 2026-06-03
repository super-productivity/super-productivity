package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.service.ReminderAlarmStore
import com.superproductivity.superproductivity.service.ReminderNotificationHelper
import com.superproductivity.superproductivity.service.SyncReminderScheduler

/**
 * Re-registers all saved alarms after device reboot or app update.
 * Android clears all AlarmManager alarms on both events, so this receiver
 * reads persisted alarm data and re-schedules them. Without the app-update
 * path, reminders would silently stop firing after a Play Store auto-update
 * until the user next opens the app.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        Log.d(TAG, "Received $action, re-registering alarms")

        val alarms = ReminderAlarmStore.getAll(context)
        if (alarms.isEmpty()) {
            Log.d(TAG, "No alarms to re-register")
            return
        }

        for (alarm in alarms) {
            Log.d(TAG, "Re-scheduling alarm: id=${alarm.notificationId}, title=${alarm.title}")
            ReminderNotificationHelper.scheduleReminder(
                context,
                alarm.notificationId,
                alarm.reminderId,
                alarm.relatedId,
                alarm.title,
                alarm.reminderType,
                alarm.triggerAtMs,
                alarm.useAlarmStyle,
                alarm.isOngoing
            )
        }

        Log.d(TAG, "Re-registered ${alarms.size} alarms")

        // Re-schedule the background sync worker if credentials are configured
        if (BackgroundSyncCredentialStore.get(context) != null) {
            SyncReminderScheduler.ensureScheduled(context)
        }
    }
}
