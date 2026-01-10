package com.superproductivity.superproductivity.service

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationManagerCompat

class TrackingForegroundService : Service() {

    companion object {
        const val TAG = "TrackingService"

        const val ACTION_START = "com.superproductivity.ACTION_START_TRACKING"
        const val ACTION_STOP = "com.superproductivity.ACTION_STOP_TRACKING"
        const val ACTION_UPDATE = "com.superproductivity.ACTION_UPDATE_TRACKING"
        const val ACTION_PAUSE = "com.superproductivity.ACTION_PAUSE_TRACKING"
        const val ACTION_DONE = "com.superproductivity.ACTION_MARK_DONE"
        const val ACTION_GET_ELAPSED = "com.superproductivity.ACTION_GET_ELAPSED"

        const val EXTRA_TASK_ID = "task_id"
        const val EXTRA_TASK_TITLE = "task_title"
        const val EXTRA_TIME_SPENT = "time_spent_ms"

        // Static state accessible from JavaScriptInterface
        @Volatile
        var currentTaskId: String? = null
            private set

        @Volatile
        var startTimestamp: Long = 0
            private set

        @Volatile
        var accumulatedMs: Long = 0
            private set

        @Volatile
        var isTracking: Boolean = false
            private set

        fun getElapsedMs(): Long {
            return if (isTracking && startTimestamp > 0) {
                (System.currentTimeMillis() - startTimestamp) + accumulatedMs
            } else {
                accumulatedMs
            }
        }
    }

    private var taskTitle: String = ""

    private val handler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            if (isTracking) {
                updateNotification()
                handler.postDelayed(this, 1000)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        TrackingNotificationHelper.createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: action=${intent?.action}")

        when (intent?.action) {
            ACTION_START -> {
                val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return START_NOT_STICKY
                val title = intent.getStringExtra(EXTRA_TASK_TITLE) ?: "Task"
                val timeSpentMs = intent.getLongExtra(EXTRA_TIME_SPENT, 0L)

                startTracking(taskId, title, timeSpentMs)
            }

            ACTION_UPDATE -> {
                val timeSpentMs = intent.getLongExtra(EXTRA_TIME_SPENT, accumulatedMs)
                updateTimeSpent(timeSpentMs)
            }

            ACTION_STOP -> {
                stopTracking()
            }

            else -> {
                // Service restarted by system - we have no state to restore
                Log.d(TAG, "Service started without action, stopping")
                stopSelf()
            }
        }

        return START_NOT_STICKY
    }

    private fun startTracking(taskId: String, title: String, timeSpentMs: Long) {
        Log.d(TAG, "Starting tracking: taskId=$taskId, title=$title, timeSpentMs=$timeSpentMs")

        currentTaskId = taskId
        taskTitle = title
        accumulatedMs = timeSpentMs
        startTimestamp = System.currentTimeMillis()
        isTracking = true

        // Start foreground immediately to avoid ANR
        val notification = TrackingNotificationHelper.buildNotification(
            this,
            taskTitle,
            getElapsedMs()
        )
        startForeground(TrackingNotificationHelper.NOTIFICATION_ID, notification)

        // Start update loop
        handler.removeCallbacks(updateRunnable)
        handler.post(updateRunnable)
    }

    private fun updateTimeSpent(timeSpentMs: Long) {
        if (!isTracking) {
            Log.d(TAG, "Ignoring updateTimeSpent: not tracking")
            return
        }
        Log.d(TAG, "Updating time spent: timeSpentMs=$timeSpentMs (was accumulated=$accumulatedMs)")

        // Reset the timer with the new accumulated value
        accumulatedMs = timeSpentMs
        startTimestamp = System.currentTimeMillis()

        // Update notification immediately
        updateNotification()
    }

    private fun stopTracking() {
        Log.d(TAG, "Stopping tracking, elapsed=${getElapsedMs()}ms")

        isTracking = false
        handler.removeCallbacks(updateRunnable)

        // Reset state
        currentTaskId = null
        startTimestamp = 0
        accumulatedMs = 0

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateNotification() {
        if (!isTracking) return

        try {
            val notification = TrackingNotificationHelper.buildNotification(
                this,
                taskTitle,
                getElapsedMs()
            )
            NotificationManagerCompat.from(this).notify(
                TrackingNotificationHelper.NOTIFICATION_ID,
                notification
            )
        } catch (e: SecurityException) {
            Log.w(TAG, "No permission to post notification", e)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        isTracking = false
        handler.removeCallbacks(updateRunnable)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.d(TAG, "Task removed, stopping service")
        stopTracking()
    }
}
