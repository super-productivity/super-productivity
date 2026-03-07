package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.superproductivity.superproductivity.service.ReminderAlarmStore
import com.superproductivity.superproductivity.service.ReminderNotificationHelper

/**
 * Re-registers all saved alarms after device reboot.
 * Android clears all AlarmManager alarms on restart, so this receiver
 * reads persisted alarm data and re-schedules them.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.d(TAG, "Boot completed, re-registering alarms")

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
    }
}
