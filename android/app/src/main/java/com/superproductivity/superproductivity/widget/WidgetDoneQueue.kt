package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

/**
 * SharedPreferences-backed queue for "mark done" task IDs from widget checkbox taps.
 * Accumulates IDs (multiple presses before the app next runs) as a JSON array.
 * Angular is the only consumer (via JavaScriptInterface.getWidgetDoneQueue) and the
 * only writer of the `widget_data` snapshot; the widget itself only ever peek()s so
 * pending taps render as done without native code mutating the blob.
 */
object WidgetDoneQueue {
    private const val PREFS_NAME = "SuperProductivityWidgetDone"
    private const val KEY_DONE_TASKS = "WIDGET_DONE_TASK_IDS"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun add(context: Context, taskId: String) {
        val prefs = getPrefs(context)
        val array = prefs.getString(KEY_DONE_TASKS, null)?.let {
            try {
                JSONArray(it)
            } catch (e: Exception) {
                JSONArray()
            }
        } ?: JSONArray()
        array.put(taskId)
        // commit (not apply): the enqueue runs in a short-lived broadcast, the process
        // may be killed right after — the tap must survive that.
        prefs.edit().putString(KEY_DONE_TASKS, array.toString()).commit()
    }

    /** Non-clearing read used to overlay pending done state at widget render time. */
    @Synchronized
    fun peek(context: Context): Set<String> {
        val data = getPrefs(context).getString(KEY_DONE_TASKS, null) ?: return emptySet()
        return try {
            val array = JSONArray(data)
            (0 until array.length()).mapTo(mutableSetOf()) { array.getString(it) }
        } catch (e: Exception) {
            emptySet()
        }
    }

    /** @return JSON array string of queued task IDs, or null if empty. */
    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val data = prefs.getString(KEY_DONE_TASKS, null)
        if (data != null) {
            prefs.edit().remove(KEY_DONE_TASKS).commit()
        }
        return data
    }
}
