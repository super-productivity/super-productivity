package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * SharedPreferences-backed queue for persisting snooze events from notification actions.
 * Stores {taskId, newRemindAt} pairs so the frontend can update NgRx state on next app open.
 */
object ReminderSnoozeQueue {
    private const val PREFS_NAME = "SuperProductivityReminderSnooze"
    private const val KEY_SNOOZE_EVENTS = "SNOOZE_EVENTS"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun addSnoozeEvent(context: Context, taskId: String, newRemindAt: Long) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_SNOOZE_EVENTS, null)
        val array = if (existing != null) JSONArray(existing) else JSONArray()
        val entry = JSONObject().apply {
            put("taskId", taskId)
            put("newRemindAt", newRemindAt)
        }
        array.put(entry)
        prefs.edit().putString(KEY_SNOOZE_EVENTS, array.toString()).commit()
    }

    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val data = prefs.getString(KEY_SNOOZE_EVENTS, null)
        if (data != null) {
            prefs.edit().remove(KEY_SNOOZE_EVENTS).commit()
        }
        return data
    }
}
