package com.superproductivity.superproductivity.service

import android.content.Context

/**
 * The user's reminder settings, mirrored from the WebView
 * (AndroidSyncBridgeEffects.syncReminderSettingsToNative$) so
 * [SyncReminderWorker] schedules alarms like the app would while it is closed.
 *
 * Not sensitive, so plain SharedPreferences. Until the WebView first mirrors
 * them (old JS bundle), the defaults keep the worker's previous behavior.
 */
object BackgroundReminderSettingsStore {
    private const val PREFS_NAME = "SuperProductivityReminderSettings"
    private const val KEY_IS_DISABLED = "IS_DISABLED"
    private const val KEY_USE_ALARM_STYLE = "USE_ALARM_STYLE"
    private const val KEY_START_OF_NEXT_DAY_DIFF_MS = "START_OF_NEXT_DAY_DIFF_MS"
    /** Matches the app's start-of-next-day cap (0 through 23 hours). */
    private const val MAX_START_OF_NEXT_DAY_DIFF_MS = 23L * 60L * 60L * 1000L

    data class Settings(
        val isDisabled: Boolean,
        val useAlarmStyle: Boolean,
        /**
         * Same offset the app passes to getRepeatDueWithTime. 0 until a WebView
         * new enough to call [saveStartOfNextDayDiffMs] has run; the two-arg
         * settings mirror must not clear it.
         */
        val startOfNextDayDiffMs: Long = 0L,
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun save(context: Context, isDisabled: Boolean, useAlarmStyle: Boolean) {
        prefs(context).edit()
            .putBoolean(KEY_IS_DISABLED, isDisabled)
            .putBoolean(KEY_USE_ALARM_STYLE, useAlarmStyle)
            .apply()
    }

    /** Separate from [save] so an old WebView that only sets the two flags keeps the offset. */
    fun saveStartOfNextDayDiffMs(context: Context, diffMs: Long) {
        val clamped = diffMs.coerceIn(0L, MAX_START_OF_NEXT_DAY_DIFF_MS)
        prefs(context).edit()
            .putLong(KEY_START_OF_NEXT_DAY_DIFF_MS, clamped)
            .apply()
    }

    fun get(context: Context): Settings {
        val p = prefs(context)
        return Settings(
            isDisabled = p.getBoolean(KEY_IS_DISABLED, false),
            useAlarmStyle = p.getBoolean(KEY_USE_ALARM_STYLE, false),
            startOfNextDayDiffMs = p.getLong(KEY_START_OF_NEXT_DAY_DIFF_MS, 0L)
                .coerceIn(0L, MAX_START_OF_NEXT_DAY_DIFF_MS),
        )
    }
}
