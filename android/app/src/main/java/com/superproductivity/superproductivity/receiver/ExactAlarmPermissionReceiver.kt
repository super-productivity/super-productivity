package com.superproductivity.superproductivity.receiver

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.superproductivity.superproductivity.service.ReminderNotificationHelper

/**
 * Re-registers all saved alarms once the user grants "Alarms & reminders"
 * (SCHEDULE_EXACT_ALARM). Alarms scheduled while the permission was denied
 * (the default on Android 14+ fresh installs) were registered as inexact and
 * would otherwise stay inexact until the next reboot or app update. Issue #10684.
 *
 * Android sends this broadcast only on grant; a revoke kills the app and
 * cancels its exact alarms instead.
 */
class ExactAlarmPermissionReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "ExactAlarmPermReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        if (intent.action != AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED) return

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!alarmManager.canScheduleExactAlarms()) {
            Log.d(TAG, "Exact alarm permission state changed but not granted, skipping")
            return
        }

        val count = ReminderNotificationHelper.rescheduleAllFromStore(context)
        Log.d(TAG, "Exact alarm permission granted, re-registered $count alarms as exact")
    }
}
