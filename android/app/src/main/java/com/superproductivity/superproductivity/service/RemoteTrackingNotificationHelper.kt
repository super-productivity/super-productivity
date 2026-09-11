package com.superproductivity.superproductivity.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R

/**
 * Notification mirroring what ANOTHER device is currently tracking (SuperSync
 * tracking presence). Strictly a viewer surface — it is fed by the WebView
 * while the app process is alive and NEVER ticks a chronometer: relayed state
 * only claims what the producer last announced.
 *
 * Honesty rules baked in here:
 * - Dedicated silent channel: the OS channel toggle is the opt-out, and no
 *   transition ever makes a sound (presence is the user's own activity).
 * - `setTimeoutAfter`: the WebView's WebSocket dies quickly in the background
 *   while a posted notification would outlive the process — without the
 *   timeout the common failure state is a frozen "Tracking…" lie hours after
 *   the other device stopped. Each heartbeat-driven update re-arms it.
 * - Not ongoing: the takeover rule guarantees at most one active session, but
 *   this is remote info, so the user may always swipe it away.
 */
object RemoteTrackingNotificationHelper {
    const val CHANNEL_ID = "sp_remote_tracking_channel"
    const val NOTIFICATION_ID = 1004
    const val ACTION_REMOTE_STOP =
        "com.superproductivity.superproductivity.REMOTE_TRACKING_STOP"

    /** Self-destruct after ~2.5 missed heartbeats (heartbeat = 60s). */
    private const val TIMEOUT_MS = 150_000L

    /** Channel creation is a binder call; do it once, not per update. */
    @Volatile
    private var isChannelCreated = false

    fun createChannel(context: Context) {
        if (!isChannelCreated && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Tracking on other devices",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows time tracking running on your other devices"
                setShowBadge(false)
            }
            val notificationManager =
                context.getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
            isChannelCreated = true
        }
    }

    /**
     * Posts or updates (same id -> silent in-place mutation) the remote
     * tracking notification. Title/text arrive pre-translated from the
     * WebView. The Stop action goes through the Activity (unlock required on
     * a locked phone — kills pocket-taps) and is omitted for paused/stale
     * states where there is nothing running to stop.
     */
    fun show(context: Context, title: String, text: String, showStopAction: Boolean) {
        createChannel(context)

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
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentPendingIntent)
            .setOngoing(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setTimeoutAfter(TIMEOUT_MS)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        if (showStopAction) {
            val stopIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                action = ACTION_REMOTE_STOP
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val stopPendingIntent = PendingIntent.getActivity(
                context,
                11,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Stop", stopPendingIntent)
        }

        notifySafely(context, builder.build())
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun notifySafely(context: Context, notification: Notification) {
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted — the in-app chip still shows the
            // state, so silently doing nothing is the correct degradation.
        }
    }
}
