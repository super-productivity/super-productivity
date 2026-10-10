package com.superproductivity.superproductivity.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
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

        // Static state accessible from JavaScriptInterface. Mirrored to
        // TrackingStateStore on every change so a process kill does not lose
        // the session (#7390); restoreIfIdle() reads it back in a new process.
        @Volatile
        internal var taskTitle: String = ""
            private set

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

        fun getElapsedMs(): Long {
            return if (isTracking && startTimestamp > 0) {
                (System.currentTimeMillis() - startTimestamp) + accumulatedMs
            } else {
                accumulatedMs
            }
        }

        // The state helpers below share the companion lock so a bridge-thread
        // restoreIfIdle() cannot re-load a session that a main-thread stop is
        // in the middle of clearing.

        @Synchronized
        internal fun setState(context: Context, state: TrackingState) {
            TrackingStateStore.save(context, state)
            applyInMemory(state)
        }

        @Synchronized
        fun clearState(context: Context) {
            isTracking = false
            currentTaskId = null
            startTimestamp = 0
            accumulatedMs = 0
            taskTitle = ""
            TrackingStateStore.clear(context)
        }

        /**
         * After a process kill the companion starts empty while the persisted
         * session is still on disk (every stop clears both, so this only happens
         * in a new process). Load it back, with the total frozen at the old
         * process's death, so getTrackingElapsed() hands the JS cold-start
         * recovery the time tracked until the kill. The in-memory state wins
         * whenever it is live, so this never re-anchors a running session.
         */
        @Synchronized
        fun restoreIfIdle(context: Context) {
            if (isTracking) return
            val persisted = TrackingStateStore.load(context) ?: return
            val exitTimestamp = TrackingState.pickExitTimestamp(
                TrackingStateStore.anchorProcessExitTimestamps(context),
                persisted.startTimestamp
            )
            val state = persisted.frozenAtExit(exitTimestamp, System.currentTimeMillis())
            Log.d(
                TAG,
                "Restoring persisted tracking state: taskId=${state.taskId}, " +
                    "exitKnown=${exitTimestamp != null}"
            )
            // Persist the re-anchored state too, so a second kill before JS
            // re-anchors is measured from here rather than the old anchor.
            setState(context, state)
        }

        /**
         * The active session as (taskId, elapsedMs) for the JS bridge, restoring
         * a persisted one first, or null when nothing is tracked. Read under the
         * companion lock so a main-thread start/update/stop cannot interleave
         * and pair one task's id with another task's total.
         */
        @Synchronized
        fun snapshotForBridge(context: Context): Pair<String, Long>? {
            restoreIfIdle(context)
            val taskId = currentTaskId
            return if (isTracking && taskId != null) taskId to getElapsedMs() else null
        }

        private fun applyInMemory(state: TrackingState) {
            currentTaskId = state.taskId
            taskTitle = state.taskTitle
            // Anchor first, accumulated second: a torn getElapsedMs() read from
            // the JS bridge thread then under-reports (caught by the
            // negative-duration keep-app-value path) instead of double-counting
            // the since-last-anchor gap — which can be hours now that nothing
            // re-anchors every second.
            startTimestamp = state.startTimestamp
            accumulatedMs = state.accumulatedMs
            isTracking = true
        }
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        TrackingNotificationHelper.createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: action=${intent?.action}")
        // A fresh process (after a kill) has an empty companion: reload the
        // persisted session so ACTION_UPDATE/STOP act on it and the
        // notification shows the task again.
        restoreIfIdle(this)

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
                val taskId = intent.getStringExtra(EXTRA_TASK_ID)
                if (taskId == null) {
                    Log.w(TAG, "ACTION_START without taskId")
                    if (!isTracking) {
                        stopForegroundAndSelf()
                    }
                    return START_NOT_STICKY
                }
                val title = intent.getStringExtra(EXTRA_TASK_TITLE) ?: "Task"
                val timeSpentMs = intent.getLongExtra(EXTRA_TIME_SPENT, 0L)

                if (!startTracking(taskId, title, timeSpentMs)) {
                    reportForegroundFailure()
                    stopAfterForegroundFailure(startId)
                    return START_NOT_STICKY
                }
            }

            ACTION_UPDATE -> {
                if (!isTracking) {
                    Log.d(TAG, "Ignoring ACTION_UPDATE - service not tracking")
                    stopForegroundAndSelf()
                    return START_NOT_STICKY
                }
                val timeSpentMs = intent.getLongExtra(EXTRA_TIME_SPENT, accumulatedMs)
                updateTimeSpent(timeSpentMs)
            }

            ACTION_STOP -> {
                if (isTracking) {
                    stopTracking()
                } else {
                    Log.d(TAG, "Ignoring STOP action - service not tracking")
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
            if (isTracking && taskTitle.isNotEmpty()) {
                TrackingNotificationHelper.buildNotification(
                    this,
                    taskTitle,
                    getElapsedMs()
                )
            } else {
                // A content title is required on some OEM skins (notably Samsung
                // One UI) - a title-less notification can render blank or cause
                // startForeground() to throw IllegalArgumentException on a few
                // Android 14 builds, which would re-trigger the FGS timeout.
                androidx.core.app.NotificationCompat.Builder(
                    this,
                    TrackingNotificationHelper.CHANNEL_ID
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
        return startForegroundSpecialUse(TrackingNotificationHelper.NOTIFICATION_ID, notification)
    }

    private fun stopForegroundAndSelf() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stopAfterForegroundFailure(startId: Int) {
        clearState(this)
        stopSelf(startId)
    }

    private fun reportForegroundFailure() {
        ForegroundServiceFailure.send(
            this,
            ForegroundServiceFailure.SERVICE_TRACKING,
            ForegroundServiceFailure.REASON_PROMOTION_FAILED
        )
    }

    private fun startTracking(taskId: String, title: String, timeSpentMs: Long): Boolean {
        Log.d(TAG, "Starting tracking: taskId=$taskId, timeSpentMs=$timeSpentMs")

        setState(
            this,
            TrackingState(
                taskId,
                title,
                System.currentTimeMillis(),
                timeSpentMs,
                TrackingStateStore.currentBootCount(this)
            )
        )

        // The foreground-service start token was already satisfied at the top
        // of onStartCommand(). Replace the placeholder notification without
        // risking a second startForeground() failure resetting tracking state.
        // The chronometer in the notification ticks on its own — no update
        // loop needed (#8243).
        return updateNotification()
    }

    private fun updateTimeSpent(timeSpentMs: Long) {
        if (!isTracking) {
            Log.d(TAG, "Ignoring updateTimeSpent: not tracking")
            return
        }
        Log.d(TAG, "Updating time spent: timeSpentMs=$timeSpentMs (was accumulated=$accumulatedMs)")

        val taskId = currentTaskId ?: return
        // Reset the timer with the new accumulated value (anchor ordering: see
        // applyInMemory).
        setState(
            this,
            TrackingState(
                taskId,
                taskTitle,
                System.currentTimeMillis(),
                timeSpentMs,
                TrackingStateStore.currentBootCount(this)
            )
        )

        // Update notification immediately
        updateNotification()
    }

    private fun stopTracking() {
        Log.d(TAG, "Stopping tracking, elapsed=${getElapsedMs()}ms")

        clearState(this)

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun updateNotification(): Boolean {
        if (!isTracking) return true

        return try {
            val notification = TrackingNotificationHelper.buildNotification(
                this,
                taskTitle,
                getElapsedMs()
            )
            NotificationManagerCompat.from(this).notify(
                TrackingNotificationHelper.NOTIFICATION_ID,
                notification
            )
            true
        } catch (e: RuntimeException) {
            Log.w(TAG, "Unable to update tracking notification", e)
            false
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        // onDestroy only runs for an explicit stop (stopService/stopSelf); a
        // process kill skips it, which is exactly when the persisted session
        // must survive. Clear it here so a stopped session is never recovered.
        clearState(this)
        // Heal a never-promoted start: if the service was created but torn down
        // before onStartCommand cleared it, drop the stale flag so the next cold
        // stop uses stopService() rather than needlessly re-spawning the service.
        clearStartPending()
    }

    // Do not override onTaskRemoved — foreground service must survive app swipe (#7818).
}
