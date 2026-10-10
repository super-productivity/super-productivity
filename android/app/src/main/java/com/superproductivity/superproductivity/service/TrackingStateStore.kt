package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences
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
    companion object {
        const val UNKNOWN_BOOT_COUNT = -1

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

    fun save(context: Context, state: TrackingState) {
        val ok = getPrefs(context).edit()
            .putString(KEY_TASK_ID, state.taskId)
            .putString(KEY_TASK_TITLE, state.taskTitle)
            .putLong(KEY_START_TIMESTAMP, state.startTimestamp)
            .putLong(KEY_ACCUMULATED_MS, state.accumulatedMs)
            .putInt(KEY_BOOT_COUNT, state.bootCount)
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
