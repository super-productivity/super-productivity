package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed store for the localized reminder notification texts.
 *
 * Reminder notifications are built natively at alarm-fire time, long after the
 * WebView (which owns the user's language setting and translations) may be
 * gone. The frontend pushes the translated texts over the JavaScript bridge
 * whenever it schedules a reminder; this store persists them so fired,
 * snoozed and reboot-re-registered reminders all use the user's language.
 *
 * Falls back to the English texts when the frontend never pushed any
 * (e.g. an older frontend version).
 */
object ReminderNotificationTexts {
    private const val PREFS_NAME = "SuperProductivityReminderTexts"
    private const val KEY_BODY_TASK = "BODY_TASK"
    private const val KEY_BODY_DUE_DATE = "BODY_DUE_DATE"
    private const val KEY_ACTION_DONE = "ACTION_DONE"
    private const val KEY_ACTION_SNOOZE_10M = "ACTION_SNOOZE_10M"
    private const val KEY_ACTION_SNOOZE_1H = "ACTION_SNOOZE_1H"

    private const val DEFAULT_BODY_TASK = "Task reminder"
    private const val DEFAULT_BODY_DUE_DATE = "Due date reminder"
    private const val DEFAULT_ACTION_DONE = "Done"
    private const val DEFAULT_ACTION_SNOOZE_10M = "Snooze 10m"
    private const val DEFAULT_ACTION_SNOOZE_1H = "Snooze 1h"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun save(
        context: Context,
        bodyTask: String,
        bodyDueDate: String,
        actionDone: String,
        actionSnooze10m: String,
        actionSnooze1h: String
    ) {
        getPrefs(context).edit()
            .putString(KEY_BODY_TASK, bodyTask)
            .putString(KEY_BODY_DUE_DATE, bodyDueDate)
            .putString(KEY_ACTION_DONE, actionDone)
            .putString(KEY_ACTION_SNOOZE_10M, actionSnooze10m)
            .putString(KEY_ACTION_SNOOZE_1H, actionSnooze1h)
            .apply()
    }

    fun getBody(context: Context, reminderType: String): String {
        return when (reminderType) {
            "DUE_DATE" -> getText(context, KEY_BODY_DUE_DATE, DEFAULT_BODY_DUE_DATE)
            else -> getText(context, KEY_BODY_TASK, DEFAULT_BODY_TASK)
        }
    }

    fun getActionDone(context: Context): String =
        getText(context, KEY_ACTION_DONE, DEFAULT_ACTION_DONE)

    fun getActionSnooze10m(context: Context): String =
        getText(context, KEY_ACTION_SNOOZE_10M, DEFAULT_ACTION_SNOOZE_10M)

    fun getActionSnooze1h(context: Context): String =
        getText(context, KEY_ACTION_SNOOZE_1H, DEFAULT_ACTION_SNOOZE_1H)

    private fun getText(context: Context, key: String, default: String): String {
        val stored = getPrefs(context).getString(key, null)
        return if (stored.isNullOrBlank()) default else stored
    }
}
