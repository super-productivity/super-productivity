package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed queue for persisting reminder tap events.
 * Needed because on cold start from a notification tap, the WebView is not yet ready
 * when handleIntent fires, so the push-based JS call is lost.
 * The frontend drains this queue at startup (pull-based).
 */
object ReminderTapQueue {
    private const val PREFS_NAME = "SuperProductivityReminderTap"
    private const val KEY_TAP_TASK_ID = "TAP_TASK_ID"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun setTaskId(context: Context, taskId: String) {
        getPrefs(context).edit().putString(KEY_TAP_TASK_ID, taskId).commit()
    }

    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val data = prefs.getString(KEY_TAP_TASK_ID, null)
        if (data != null) {
            prefs.edit().remove(KEY_TAP_TASK_ID).commit()
        }
        return data
    }
}
