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

        // Marks the window between startForegroundService() and the first
        // startForeground() inside onStartCommand(). A stop arriving in that
        // window must NOT use stopService() — tearing down a start-foreground
        // service before it promotes crashes the process with
        // ForegroundServiceDidNotStartInTimeException (AOSP bringDownServiceLocked,
        // fired while fgRequired is still true). JavaScriptInterface reads this to
        // route such stops through onStartCommand (ACTION_STOP) instead.
        @Volatile
        var isStartPending: Boolean = false
            private set

        fun markStartPending() {
            isStartPending = true
        }

        fun clearStartPending() {
            isStartPending = false
        }

        // Live timer state mirrored into the companion so JavaScriptInterface
        // can read it back after the WebView is recreated (app reopened from
        // recents). Mirrors TrackingForegroundService's static-state pattern so
        // a focus session can be recovered into the Angular store (#7855).
        // `remainingMs` and `lastUpdateTimestamp` cannot use `private set`
        // because the completion Runnable (a nested anonymous object) mutates
        // them; the other three are written only from instance methods, so they
        // keep `private set`.
        @Volatile
        var durationMs: Long = 0
            private set

        @Volatile
        var remainingMs: Long = 0

        @Volatile
        var isBreak: Boolean = false
            private set

        @Volatile
        var isPaused: Boolean = false
            private set

        @Volatile
        var lastUpdateTimestamp: Long = 0

        /**
         * Live remaining time (countdown) or elapsed time (Flowtime, where
         * durationMs is 0 and remainingMs accumulates). The snapshot fields only
         * move on start/update/completion, so this derives the live value from
         * the wall clock — it is THE time source for the notification, the
         * completion scheduling, and the JS readback (#8243).
         *
         * Named `liveRemainingMs` rather than `getRemainingMs` to avoid a JVM
         * signature clash with the `remainingMs` property's generated getter.
         */
        fun liveRemainingMs(): Long {
            if (!isRunning || isPaused || lastUpdateTimestamp <= 0) {
                return remainingMs
            }
            val sinceLastTick = System.currentTimeMillis() - lastUpdateTimestamp
            return if (durationMs > 0) {
                (remainingMs - sinceLastTick).coerceAtLeast(0)
            } else {
                remainingMs + sinceLastTick
            }
        }
    }

    private var title: String = ""
    private var taskTitle: String? = null
    private var hasNotifiedCompletion: Boolean = false

    private val handler = Handler(Looper.getMainLooper())

    // Fires once at the expected countdown end instead of ticking every second —
    // the notification chronometer renders the live timer without app work (#8243).
    // Handler delays run on uptime, which stalls in deep sleep, so the runnable
    // can only fire at wall-clock >= the requested delay (late completion in
    // Doze, same as the old 1s loop). The re-arm branch below therefore only
    // triggers when the wall clock moved BACKWARD (manual change/NTP) — re-arming
    // keeps completion consistent with the wall-clock-based chronometer.
    private val completionRunnable = object : Runnable {
        override fun run() {
            if (!isRunning || isPaused || durationMs <= 0 || hasNotifiedCompletion) return
            val remaining = liveRemainingMs()
            if (remaining > 0) {
                handler.postDelayed(this, remaining)
                return
            }
            remainingMs = 0
            lastUpdateTimestamp = System.currentTimeMillis()
            onTimerComplete()
        }
    }

    private fun scheduleCompletionCheck() {
        handler.removeCallbacks(completionRunnable)
        if (isRunning && !isPaused && durationMs > 0) {
            handler.postDelayed(completionRunnable, liveRemainingMs())
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        FocusModeNotificationHelper.createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: action=${intent?.action}")

        // Android documents successful startForeground() as the safe path
        // after startForegroundService(). Promote before handling actions so
        // newly started services satisfy that contract.
        if (!ensureForegroundNotification()) {
            clearStartPending()
            reportForegroundFailure()
            stopAfterForegroundFailure(startId)
            return START_NOT_STICKY
        }
        clearStartPending()

        when (intent?.action) {
            ACTION_START -> {
                title = intent.getStringExtra(EXTRA_TITLE) ?: "Focus"
                taskTitle = intent.getStringExtra(EXTRA_TASK_TITLE)
                durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L)
                // Anchor before remainingMs: a torn liveRemainingMs() read from
                // the JS bridge thread then returns a slightly stale value
                // instead of subtracting the whole since-last-anchor gap.
                lastUpdateTimestamp = System.currentTimeMillis()
                remainingMs = intent.getLongExtra(EXTRA_REMAINING_MS, 0L)
                isBreak = intent.getBooleanExtra(EXTRA_IS_BREAK, false)
                isPaused = intent.getBooleanExtra(EXTRA_IS_PAUSED, false)

                if (!startFocusMode()) {
                    reportForegroundFailure()
                    stopAfterForegroundFailure(startId)
                    return START_NOT_STICKY
                }
            }

            ACTION_UPDATE -> {
                if (!isRunning) {
                    Log.d(TAG, "Ignoring ACTION_UPDATE - service not running")
                    stopForegroundAndSelf()
                    return START_NOT_STICKY
                }
                title = intent.getStringExtra(EXTRA_TITLE) ?: title
                // Defensive fallback only — the sole caller (JavaScriptInterface.
                // updateFocusModeService) always sends the extra. Anchor before
                // remainingMs (see ACTION_START) to bias torn reads safe.
                val newRemainingMs = intent.getLongExtra(EXTRA_REMAINING_MS, liveRemainingMs())
                lastUpdateTimestamp = System.currentTimeMillis()
                remainingMs = newRemainingMs
                isPaused = intent.getBooleanExtra(EXTRA_IS_PAUSED, isPaused)
                isBreak = intent.getBooleanExtra(EXTRA_IS_BREAK, isBreak)
                taskTitle = intent.getStringExtra(EXTRA_TASK_TITLE) ?: taskTitle

                scheduleCompletionCheck()
                updateNotification()
            }

            ACTION_STOP -> {
                if (isRunning) {
                    stopFocusMode()
                } else {
                    Log.d(TAG, "Ignoring STOP action - service not running")
                    stopForegroundAndSelf()
                }
            }

            else -> {
                Log.d(TAG, "Service started without action, stopping")
                stopForegroundAndSelf()
            }
        }

        return START_NOT_STICKY
    }

    private fun ensureForegroundNotification(): Boolean {
        val notification = try {
            if (isRunning && title.isNotEmpty()) {
                FocusModeNotificationHelper.buildNotification(
                    this,
                    title,
                    taskTitle,
                    remainingMs = liveRemainingMs(),
                    isCountdown = durationMs > 0,
                    isPaused = isPaused,
                    isBreak = isBreak
                )
            } else {
                // A content title is required on some OEM skins (notably Samsung
                // One UI) - a title-less notification can render blank or cause
                // startForeground() to throw IllegalArgumentException on a few
                // Android 14 builds, which would re-trigger the FGS timeout.
                androidx.core.app.NotificationCompat.Builder(
                    this,
                    FocusModeNotificationHelper.CHANNEL_ID
                )
                    .setSmallIcon(com.superproductivity.superproductivity.R.drawable.ic_stat_sp)
                    .setContentTitle(getString(com.superproductivity.superproductivity.R.string.app_name))
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .setSilent(true)
                    .build()
            }
        } catch (e: RuntimeException) {
            Log.e(TAG, "ensureForegroundNotification: failed to build notification", e)
            return false
        }
        return startForegroundSpecialUse(FocusModeNotificationHelper.NOTIFICATION_ID, notification)
    }

    private fun startFocusMode(): Boolean {
        Log.d(TAG, "Starting focus mode: title=$title, durationMs=$durationMs, remainingMs=$remainingMs, isBreak=$isBreak, isPaused=$isPaused")
        FocusModeNotificationHelper.cancelCompletionNotification(this)

        isRunning = true
        hasNotifiedCompletion = false
        lastUpdateTimestamp = System.currentTimeMillis()

        // The foreground-service start token was already satisfied at the top
        // of onStartCommand(). Replace the placeholder notification without
        // risking a second startForeground() failure resetting focus state.
        if (!updateNotification()) {
            return false
        }

        scheduleCompletionCheck()
        return true
    }

    private fun stopForegroundAndSelf() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stopAfterForegroundFailure(startId: Int) {
        isRunning = false
        handler.removeCallbacks(completionRunnable)
        title = ""
        taskTitle = null
        durationMs = 0
        remainingMs = 0
        isBreak = false
        isPaused = false
        lastUpdateTimestamp = 0
        hasNotifiedCompletion = false
        stopSelf(startId)
    }

    private fun reportForegroundFailure() {
        ForegroundServiceFailure.send(
            this,
            ForegroundServiceFailure.SERVICE_FOCUS_MODE,
            ForegroundServiceFailure.REASON_PROMOTION_FAILED
        )
    }

    private fun stopFocusMode() {
        Log.d(TAG, "Stopping focus mode")

        isRunning = false
        handler.removeCallbacks(completionRunnable)

        // Clear the mirrored state so a stale session can't be recovered after
        // it has legitimately ended (#7855).
        durationMs = 0
        remainingMs = 0
        isBreak = false
        isPaused = false
        lastUpdateTimestamp = 0

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateNotification(): Boolean {
        if (!isRunning) return true

        return try {
            val notification = FocusModeNotificationHelper.buildNotification(
                this,
                title,
                taskTitle,
                remainingMs = liveRemainingMs(),
                isCountdown = durationMs > 0,
                isPaused = isPaused,
                isBreak = isBreak
            )
            NotificationManagerCompat.from(this).notify(
                FocusModeNotificationHelper.NOTIFICATION_ID,
                notification
            )
            true
        } catch (e: RuntimeException) {
            Log.w(TAG, "Unable to update focus mode notification", e)
            false
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
        // Heal a never-promoted start: if the service was created but torn down
        // before onStartCommand cleared it, drop the stale flag so the next cold
        // stop uses stopService() rather than needlessly re-spawning the service.
        clearStartPending()
        handler.removeCallbacks(completionRunnable)
    }

    // Do not override onTaskRemoved — foreground service must survive app swipe (#7818).
}
