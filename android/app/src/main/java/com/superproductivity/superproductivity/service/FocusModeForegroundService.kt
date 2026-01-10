package com.superproductivity.superproductivity.service

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager

class FocusModeForegroundService : Service() {

    companion object {
        const val TAG = "FocusModeService"

        const val ACTION_START = "com.superproductivity.ACTION_START_FOCUS"
        const val ACTION_STOP = "com.superproductivity.ACTION_STOP_FOCUS"
        const val ACTION_UPDATE = "com.superproductivity.ACTION_UPDATE_FOCUS"
        const val ACTION_PAUSE = "com.superproductivity.ACTION_PAUSE_FOCUS"
        const val ACTION_RESUME = "com.superproductivity.ACTION_RESUME_FOCUS"
        const val ACTION_SKIP = "com.superproductivity.ACTION_SKIP_FOCUS"
        const val ACTION_COMPLETE = "com.superproductivity.ACTION_COMPLETE_FOCUS"
        const val ACTION_TIMER_COMPLETE = "com.superproductivity.ACTION_TIMER_COMPLETE_FOCUS"

        const val EXTRA_TITLE = "title"
        const val EXTRA_TASK_TITLE = "task_title"
        const val EXTRA_DURATION_MS = "duration_ms"
        const val EXTRA_REMAINING_MS = "remaining_ms"
        const val EXTRA_IS_BREAK = "is_break"
        const val EXTRA_IS_PAUSED = "is_paused"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private var title: String = ""
    private var taskTitle: String? = null
    private var durationMs: Long = 0
    private var remainingMs: Long = 0
    private var isBreak: Boolean = false
    private var isPaused: Boolean = false
    private var lastUpdateTimestamp: Long = 0
    private var hasNotifiedCompletion: Boolean = false

    private val handler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            if (isRunning && !isPaused) {
                // Update remaining time (countdown mode)
                val now = System.currentTimeMillis()
                val elapsed = now - lastUpdateTimestamp
                lastUpdateTimestamp = now

                if (durationMs > 0) {
                    // Countdown mode: decrease remaining time
                    val previousRemaining = remainingMs
                    remainingMs = (remainingMs - elapsed).coerceAtLeast(0)

                    // Check for timer completion (only in countdown mode, not Flowtime)
                    if (remainingMs == 0L && previousRemaining > 0L && !hasNotifiedCompletion) {
                        onTimerComplete()
                        return // Stop the runnable, timer is done
                    }
                } else {
                    // Flowtime mode: increase elapsed time (remainingMs is actually elapsed)
                    remainingMs += elapsed
                }

                updateNotification()
                handler.postDelayed(this, 1000)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        FocusModeNotificationHelper.createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: action=${intent?.action}")

        when (intent?.action) {
            ACTION_START -> {
                title = intent.getStringExtra(EXTRA_TITLE) ?: "Focus"
                taskTitle = intent.getStringExtra(EXTRA_TASK_TITLE)
                durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L)
                remainingMs = intent.getLongExtra(EXTRA_REMAINING_MS, 0L)
                isBreak = intent.getBooleanExtra(EXTRA_IS_BREAK, false)
                isPaused = intent.getBooleanExtra(EXTRA_IS_PAUSED, false)

                startFocusMode()
            }

            ACTION_UPDATE -> {
                val wasPaused = isPaused
                title = intent.getStringExtra(EXTRA_TITLE) ?: title
                remainingMs = intent.getLongExtra(EXTRA_REMAINING_MS, remainingMs)
                isPaused = intent.getBooleanExtra(EXTRA_IS_PAUSED, isPaused)
                isBreak = intent.getBooleanExtra(EXTRA_IS_BREAK, isBreak)
                taskTitle = intent.getStringExtra(EXTRA_TASK_TITLE) ?: taskTitle
                lastUpdateTimestamp = System.currentTimeMillis()

                // Restart update runnable if resuming from paused state
                if (wasPaused && !isPaused) {
                    handler.removeCallbacks(updateRunnable)
                    handler.post(updateRunnable)
                } else if (!wasPaused && isPaused) {
                    handler.removeCallbacks(updateRunnable)
                }

                updateNotification()
            }

            ACTION_STOP -> {
                stopFocusMode()
            }

            else -> {
                // Service restarted by system - we have no state to restore
                Log.d(TAG, "Service started without action, stopping")
                stopSelf()
            }
        }

        return START_NOT_STICKY
    }

    private fun startFocusMode() {
        Log.d(TAG, "Starting focus mode: title=$title, durationMs=$durationMs, remainingMs=$remainingMs, isBreak=$isBreak, isPaused=$isPaused")

        isRunning = true
        hasNotifiedCompletion = false
        lastUpdateTimestamp = System.currentTimeMillis()

        // Start foreground immediately to avoid ANR
        val notification = FocusModeNotificationHelper.buildNotification(
            this,
            title,
            taskTitle,
            remainingMs,
            isPaused,
            isBreak
        )
        startForeground(FocusModeNotificationHelper.NOTIFICATION_ID, notification)

        // Start update loop if not paused
        handler.removeCallbacks(updateRunnable)
        if (!isPaused) {
            handler.post(updateRunnable)
        }
    }

    private fun stopFocusMode() {
        Log.d(TAG, "Stopping focus mode")

        isRunning = false
        handler.removeCallbacks(updateRunnable)

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateNotification() {
        if (!isRunning) return

        try {
            val notification = FocusModeNotificationHelper.buildNotification(
                this,
                title,
                taskTitle,
                remainingMs,
                isPaused,
                isBreak
            )
            NotificationManagerCompat.from(this).notify(
                FocusModeNotificationHelper.NOTIFICATION_ID,
                notification
            )
        } catch (e: SecurityException) {
            Log.w(TAG, "No permission to post notification", e)
        }
    }

    private fun onTimerComplete() {
        Log.d(TAG, "Timer completed! isBreak=$isBreak, title=$title")
        hasNotifiedCompletion = true

        // Show high-priority completion notification with sound
        val completionTitle = if (isBreak) "Break Complete" else "Session Complete"
        val completionMessage = if (isBreak) {
            "Time to get back to work!"
        } else {
            taskTitle?.let { "Great job on: $it" } ?: "Great job! Take a break."
        }
        FocusModeNotificationHelper.showCompletionNotification(
            this,
            completionTitle,
            completionMessage,
            isBreak
        )

        // Notify the frontend via local broadcast
        val intent = Intent(ACTION_TIMER_COMPLETE).apply {
            putExtra(EXTRA_IS_BREAK, isBreak)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)

        // Stop the foreground service (timer is done)
        stopFocusMode()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        isRunning = false
        handler.removeCallbacks(updateRunnable)
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.d(TAG, "Task removed, stopping service")
        stopFocusMode()
    }
}
