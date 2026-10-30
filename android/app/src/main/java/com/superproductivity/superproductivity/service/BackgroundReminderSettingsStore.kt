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

    data class Settings(
        val isDisabled: Boolean,
        val useAlarmStyle: Boolean
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun save(context: Context, isDisabled: Boolean, useAlarmStyle: Boolean) {
        prefs(context).edit()
            .putBoolean(KEY_IS_DISABLED, isDisabled)
            .putBoolean(KEY_USE_ALARM_STYLE, useAlarmStyle)
            .apply()
    }

    fun get(context: Context): Settings {
        val p = prefs(context)
        return Settings(
            isDisabled = p.getBoolean(KEY_IS_DISABLED, false),
            useAlarmStyle = p.getBoolean(KEY_USE_ALARM_STYLE, false)
        )
    }
}
