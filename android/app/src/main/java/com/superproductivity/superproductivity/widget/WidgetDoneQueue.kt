package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * SharedPreferences-backed queue of pending done-state changes from widget
 * checkbox taps, stored as a JSON object map `{taskId: targetIsDone}` — last tap
 * per task wins, so tapping a task done and back to undone before the app runs
 * collapses into a single (or no-op) change.
 *
 * Angular is the only consumer (JavaScriptInterface.getWidgetDoneQueue) and the
 * only writer of the `widget_data` snapshot; the widget itself only ever peek()s
 * so pending taps render correctly without native code mutating the blob.
 */
object WidgetDoneQueue {
    private const val PREFS_NAME = "SuperProductivityWidgetDone"
    private const val KEY_DONE_TASKS = "WIDGET_DONE_TASK_IDS"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun setTarget(context: Context, taskId: String, isDone: Boolean) {
        val prefs = getPrefs(context)
        val map = prefs.getString(KEY_DONE_TASKS, null)?.let {
            try {
                JSONObject(it)
            } catch (e: Exception) {
                JSONObject()
            }
        } ?: JSONObject()
        map.put(taskId, isDone)
        // commit (not apply): the enqueue runs in a short-lived broadcast, the process
        // may be killed right after — the tap must survive that.
        prefs.edit().putString(KEY_DONE_TASKS, map.toString()).commit()
    }

    /** Non-clearing read used to overlay pending done state at widget render time. */
    @Synchronized
    fun peek(context: Context): Map<String, Boolean> {
        val data = getPrefs(context).getString(KEY_DONE_TASKS, null) ?: return emptyMap()
        return try {
            val map = JSONObject(data)
            map.keys().asSequence().associateWith { map.getBoolean(it) }
        } catch (e: Exception) {
            emptyMap()
        }
    }

    /** @return JSON object string `{taskId: targetIsDone}`, or null if empty. */
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
