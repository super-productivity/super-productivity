package com.superproductivity.superproductivity.service

import android.app.ActivityManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Log

/**
 * One active tracking session as the native service counts it: the total at
 * the last anchor plus the wall-clock time since then. Wall clock (not
 * elapsedRealtime) because the anchor has to outlive the process.
 */
data class TrackingState(
    val taskId: String,
    val taskTitle: String,
    val startTimestamp: Long,
    val accumulatedMs: Long,
    val bootCount: Int,
) {
    /**
     * The session as recovered in a new process: the total stops at the moment
     * the old process died, and counting resumes from [nowMs]. Time while the
     * app was dead is never credited — a force-stop or an app update would
     * otherwise add everything up to the next launch, possibly days. Without a
     * known exit time (API < 30, no matching record) only the total at the last
     * anchor is kept, the same outcome as before persistence existed.
     */
    fun frozenAtExit(exitTimestamp: Long?, nowMs: Long): TrackingState {
        val trackedUntilExit = if (exitTimestamp != null && exitTimestamp >= startTimestamp) {
            minOf(exitTimestamp, nowMs) - startTimestamp
        } else {
            0L
        }
        return copy(
            startTimestamp = nowMs,
            accumulatedMs = accumulatedMs + trackedUntilExit.coerceAtLeast(0)
        )
    }

    companion object {
        const val UNKNOWN_BOOT_COUNT = -1

        /**
         * The death of the process that last anchored this session is the
         * earliest recorded exit of that process (matched by pid) at or after
         * the anchor.
         */
        fun pickExitTimestamp(exitTimestamps: List<Long>, startTimestamp: Long): Long? =
            exitTimestamps.filter { it >= startTimestamp }.minOrNull()

        /**
         * Rebuilds a persisted session, or null when there is nothing usable.
         * A session from an earlier boot is dropped: the device was off for an
         * unknown part of the gap, so it cannot be credited as tracked time —
         * the same outcome as before persistence existed.
         */
        fun fromPersisted(
            taskId: String?,
            taskTitle: String?,
            startTimestamp: Long,
            accumulatedMs: Long,
            persistedBootCount: Int,
            currentBootCount: Int,
        ): TrackingState? {
            if (taskId.isNullOrEmpty() || startTimestamp <= 0 || accumulatedMs < 0) {
                return null
            }
            if (persistedBootCount != currentBootCount ||
                currentBootCount == UNKNOWN_BOOT_COUNT
            ) {
                return null
            }
            return TrackingState(
                taskId,
                taskTitle ?: "",
                startTimestamp,
                accumulatedMs,
                currentBootCount
            )
        }
    }
}

/**
 * Persists the active tracking session so it survives process death (#7390).
 * TrackingForegroundService otherwise keeps it only in memory; once the OS
 * kills the process (low memory, OEM task killers, a stopped user profile) the
 * JS recovery path on the next cold start would find nothing to credit.
 *
 * Writes use commit(): they happen only on start/update/stop, and an async
 * apply() can still be pending when the process is SIGKILLed.
 */
object TrackingStateStore {
    private const val TAG = "TrackingStateStore"
    private const val PREFS_NAME = "SuperProductivityTracking"
    private const val KEY_TASK_ID = "taskId"
    private const val KEY_TASK_TITLE = "taskTitle"
    private const val KEY_START_TIMESTAMP = "startTimestamp"
    private const val KEY_ACCUMULATED_MS = "accumulatedMs"
    private const val KEY_BOOT_COUNT = "bootCount"

    // pid of the process that wrote the session. Matching exit records by pid
    // (not just by name) keeps a later short-lived main process — started for a
    // widget, alarm or worker after the kill — from standing in for the real
    // death once the system has evicted that record from its bounded history.
    private const val KEY_PID = "pid"

    private fun getPrefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun currentBootCount(context: Context): Int =
        try {
            Settings.Global.getInt(
                context.contentResolver,
                Settings.Global.BOOT_COUNT,
                TrackingState.UNKNOWN_BOOT_COUNT
            )
        } catch (e: RuntimeException) {
            Log.w(TAG, "Unable to read boot count", e)
            TrackingState.UNKNOWN_BOOT_COUNT
        }

    /**
     * Wall-clock times at which the main process that wrote the persisted
     * session died, as recorded by the system (API 30+). Empty when unavailable
     * or when that record is no longer in the system's history.
     */
    fun anchorProcessExitTimestamps(context: Context): List<Long> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
        val pid = getPrefs(context).getInt(KEY_PID, 0)
        if (pid <= 0) return emptyList()
        return try {
            val am = context.getSystemService(ActivityManager::class.java)
                ?: return emptyList()
            val processName = context.applicationInfo.processName
            am.getHistoricalProcessExitReasons(context.packageName, pid, 0)
                .filter { it.pid == pid && it.processName == processName }
                .map { it.timestamp }
        } catch (e: RuntimeException) {
            Log.w(TAG, "Unable to read process exit reasons", e)
            emptyList()
        }
    }

    fun save(context: Context, state: TrackingState) {
        val ok = getPrefs(context).edit()
            .putString(KEY_TASK_ID, state.taskId)
            .putString(KEY_TASK_TITLE, state.taskTitle)
            .putLong(KEY_START_TIMESTAMP, state.startTimestamp)
            .putLong(KEY_ACCUMULATED_MS, state.accumulatedMs)
            .putInt(KEY_BOOT_COUNT, state.bootCount)
            .putInt(KEY_PID, Process.myPid())
            .commit()
        if (!ok) {
            Log.w(TAG, "Failed to persist tracking state: taskId=${state.taskId}")
        }
    }

    fun load(context: Context): TrackingState? {
        val prefs = getPrefs(context)
        val state = TrackingState.fromPersisted(
            prefs.getString(KEY_TASK_ID, null),
            prefs.getString(KEY_TASK_TITLE, null),
            prefs.getLong(KEY_START_TIMESTAMP, 0),
            prefs.getLong(KEY_ACCUMULATED_MS, -1),
            prefs.getInt(KEY_BOOT_COUNT, TrackingState.UNKNOWN_BOOT_COUNT),
            currentBootCount(context)
        )
        if (state == null && prefs.contains(KEY_TASK_ID)) {
            // Stale (earlier boot) or malformed: drop it so it is never read again.
            clear(context)
        }
        return state
    }

    fun clear(context: Context) {
        getPrefs(context).edit().clear().commit()
    }
}
