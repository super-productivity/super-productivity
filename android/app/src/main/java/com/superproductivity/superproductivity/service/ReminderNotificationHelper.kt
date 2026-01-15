package com.superproductivity.superproductivity.service

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R
import com.superproductivity.superproductivity.receiver.ReminderActionReceiver
import com.superproductivity.superproductivity.receiver.ReminderAlarmReceiver

/**
 * Simple helper for native reminder notifications.
 * Snooze works entirely in background (just reschedules alarm).
 * Tapping notification opens app.
 */
object ReminderNotificationHelper {
    const val TAG = "ReminderNotifHelper"
    const val CHANNEL_ID_ALARM = "sp_reminders_channel"
    const val CHANNEL_ID_REGULAR = "sp_reminders_regular_channel"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(NotificationManager::class.java)

            // Alarm-style channel (louder, more intrusive)
            val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            val alarmAudioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val alarmChannel = NotificationChannel(
                CHANNEL_ID_ALARM,
                "Reminders (Alarm)",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alarm-style task reminders with louder sound"
                setShowBadge(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
                setSound(alarmSound, alarmAudioAttributes)
            }
            notificationManager.createNotificationChannel(alarmChannel)

            // Regular notification channel (standard notification sound)
            val notificationSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            val notificationAudioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val regularChannel = NotificationChannel(
                CHANNEL_ID_REGULAR,
                "Reminders",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Task and note reminders"
                setShowBadge(true)
                enableVibration(true)
                setSound(notificationSound, notificationAudioAttributes)
            }
            notificationManager.createNotificationChannel(regularChannel)
        }
    }

    fun scheduleReminder(
        context: Context,
        notificationId: Int,
        reminderId: String,
        relatedId: String,
        title: String,
        reminderType: String,
        triggerAtMs: Long,
        useAlarmStyle: Boolean = false
    ) {
        Log.d(TAG, "Scheduling reminder: id=$notificationId, title=$title, useAlarmStyle=$useAlarmStyle")

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val intent = Intent(context, ReminderAlarmReceiver::class.java).apply {
            action = ReminderAlarmReceiver.ACTION_SHOW_REMINDER
            putExtra(ReminderAlarmReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_ID, reminderId)
            putExtra(ReminderAlarmReceiver.EXTRA_RELATED_ID, relatedId)
            putExtra(ReminderAlarmReceiver.EXTRA_TITLE, title)
            putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_TYPE, reminderType)
            putExtra(ReminderAlarmReceiver.EXTRA_USE_ALARM_STYLE, useAlarmStyle)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
            } else {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule reminder", e)
        }
    }

    fun cancelReminder(context: Context, notificationId: Int) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, ReminderAlarmReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context, notificationId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
        NotificationManagerCompat.from(context).cancel(notificationId)
    }

    fun showNotification(
        context: Context,
        notificationId: Int,
        reminderId: String,
        relatedId: String,
        title: String,
        reminderType: String,
        useAlarmStyle: Boolean = false
    ) {
        createChannels(context)

        val channelId = if (useAlarmStyle) CHANNEL_ID_ALARM else CHANNEL_ID_REGULAR

        // Tapping notification opens app
        val contentIntent = Intent(context, CapacitorMainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context, notificationId, contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Snooze - handled by BroadcastReceiver, no app needed
        val snoozeIntent = Intent(context, ReminderActionReceiver::class.java).apply {
            action = ReminderActionReceiver.ACTION_SNOOZE
            putExtra(ReminderActionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            putExtra(ReminderActionReceiver.EXTRA_REMINDER_ID, reminderId)
            putExtra(ReminderActionReceiver.EXTRA_RELATED_ID, relatedId)
            putExtra(ReminderActionReceiver.EXTRA_TITLE, title)
            putExtra(ReminderActionReceiver.EXTRA_REMINDER_TYPE, reminderType)
            putExtra(ReminderActionReceiver.EXTRA_USE_ALARM_STYLE, useAlarmStyle)
        }
        val snoozePendingIntent = PendingIntent.getBroadcast(
            context, notificationId * 10 + 1, snoozeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val category = if (useAlarmStyle) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_REMINDER

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_sp)
            .setContentTitle(title)
            .setContentText(if (reminderType == "TASK") "Task reminder" else "Note reminder")
            .setContentIntent(contentPendingIntent)
            .setAutoCancel(true)
            .addAction(0, "Snooze 10m", snoozePendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(category)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification)
        } catch (e: SecurityException) {
            Log.e(TAG, "No permission to show notification", e)
        }
    }
}
