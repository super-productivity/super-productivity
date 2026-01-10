package com.superproductivity.superproductivity.service

import android.app.Notification
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

object FocusModeNotificationHelper {
    private const val TAG = "FocusModeNotifHelper"
    const val CHANNEL_ID = "sp_focus_mode_channel"
    const val COMPLETION_CHANNEL_ID = "sp_focus_complete_channel"
    const val NOTIFICATION_ID = 1002
    const val COMPLETION_NOTIFICATION_ID = 1003

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Focus Mode",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows focus mode timer status"
                setShowBadge(false)
            }
            val notificationManager = context.getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun buildNotification(
        context: Context,
        title: String,
        taskTitle: String?,
        remainingMs: Long,
        isPaused: Boolean,
        isBreak: Boolean
    ): Notification {
        val contentIntent = Intent(context, CapacitorMainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            10,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sp)
            .setContentTitle(buildTitle(title, taskTitle))
            .setContentText(formatDuration(remainingMs))
            .setContentIntent(contentPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        // Add Pause/Resume action
        if (isPaused) {
            val resumeIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = FocusModeForegroundService.ACTION_RESUME
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val resumePendingIntent = PendingIntent.getActivity(
                context,
                11,
                resumeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Resume", resumePendingIntent)
        } else {
            val pauseIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = FocusModeForegroundService.ACTION_PAUSE
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pausePendingIntent = PendingIntent.getActivity(
                context,
                12,
                pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Pause", pausePendingIntent)
        }

        // Add Skip (for breaks) or Complete (for work sessions) action
        if (isBreak) {
            val skipIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = FocusModeForegroundService.ACTION_SKIP
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val skipPendingIntent = PendingIntent.getActivity(
                context,
                13,
                skipIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Skip", skipPendingIntent)
        } else {
            val completeIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = FocusModeForegroundService.ACTION_COMPLETE
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val completePendingIntent = PendingIntent.getActivity(
                context,
                14,
                completeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Complete", completePendingIntent)
        }

        return builder.build()
    }

    private fun buildTitle(focusTitle: String, taskTitle: String?): String {
        return if (taskTitle.isNullOrBlank()) {
            focusTitle
        } else {
            "$focusTitle: $taskTitle"
        }
    }

    fun formatDuration(ms: Long): String {
        val totalSeconds = ms / 1000
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format("%d:%02d", minutes, seconds)
    }

    fun createCompletionChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val channel = NotificationChannel(
                COMPLETION_CHANNEL_ID,
                "Focus Mode Completion",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alerts when focus session or break completes"
                setShowBadge(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500)
                setSound(alarmSound, audioAttributes)
            }
            val notificationManager = context.getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun showCompletionNotification(
        context: Context,
        title: String,
        message: String,
        isBreak: Boolean
    ) {
        Log.d(TAG, "Showing completion notification: title=$title, isBreak=$isBreak")
        createCompletionChannel(context)

        val contentIntent = Intent(context, CapacitorMainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            context,
            20,
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, COMPLETION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sp)
            .setContentTitle(title)
            .setContentText(message)
            .setContentIntent(contentPendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)

        if (isBreak) {
            val skipIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = FocusModeForegroundService.ACTION_SKIP
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val skipPendingIntent = PendingIntent.getActivity(
                context,
                21,
                skipIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Skip Break", skipPendingIntent)
        } else {
            val completeIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = FocusModeForegroundService.ACTION_COMPLETE
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val completePendingIntent = PendingIntent.getActivity(
                context,
                22,
                completeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Complete", completePendingIntent)
        }

        try {
            NotificationManagerCompat.from(context).notify(COMPLETION_NOTIFICATION_ID, builder.build())
        } catch (e: SecurityException) {
            Log.e(TAG, "No permission to show completion notification", e)
        }
    }

    fun cancelCompletionNotification(context: Context) {
        NotificationManagerCompat.from(context).cancel(COMPLETION_NOTIFICATION_ID)
    }
}
