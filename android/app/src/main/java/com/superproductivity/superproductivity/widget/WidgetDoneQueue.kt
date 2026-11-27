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
 *
 * Alongside, it keeps when each task was last tapped done, `{taskId: epochMs}`,
 * for the project widget's grace period ([WidgetData.PROJECT_DONE_TASK_GRACE_MS]).
 * That map is native-only and outlives Angular's drain.
 */
object WidgetDoneQueue {
    private const val PREFS_NAME = "SuperProductivityWidgetDone"
    private const val KEY_DONE_TASKS = "WIDGET_DONE_TASK_IDS"
    private const val KEY_DONE_TAP_TIMES = "WIDGET_DONE_TAP_TIMES"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private fun readJson(prefs: SharedPreferences, key: String): JSONObject =
        prefs.getString(key, null)?.let {
            try {
                JSONObject(it)
            } catch (e: Exception) {
                JSONObject()
            }
        } ?: JSONObject()

    @Synchronized
    fun setTarget(context: Context, taskId: String, isDone: Boolean) {
        val prefs = getPrefs(context)
        val map = readJson(prefs, KEY_DONE_TASKS)
        map.put(taskId, isDone)
        val tapTimes = readJson(prefs, KEY_DONE_TAP_TIMES)
        if (isDone) {
            tapTimes.put(taskId, System.currentTimeMillis())
        } else {
            tapTimes.remove(taskId)
        }
        // commit (not apply): the enqueue runs in a short-lived broadcast, the process
        // may be killed right after — the tap must survive that.
        prefs.edit()
            .putString(KEY_DONE_TASKS, map.toString())
            .putString(KEY_DONE_TAP_TIMES, tapTimes.toString())
            .commit()
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

    /**
     * Done-tap times still inside their grace period, for native rendering only.
     * Expired entries are dropped from storage on the way.
     */
    @Synchronized
    fun peekDoneTapTimes(context: Context): Map<String, Long> {
        val prefs = getPrefs(context)
        val stored = readJson(prefs, KEY_DONE_TAP_TIMES)
        val nowMs = System.currentTimeMillis()
        val active = stored.keys().asSequence()
            .associateWith { stored.optLong(it, 0L) }
            .filterValues { WidgetData.isInDoneGrace(it, nowMs) }
        if (active.size != stored.length()) {
            val editor = prefs.edit()
            if (active.isEmpty()) {
                editor.remove(KEY_DONE_TAP_TIMES)
            } else {
                editor.putString(KEY_DONE_TAP_TIMES, JSONObject(active).toString())
            }
            editor.commit()
        }
        return active
    }

    /** @return JSON object string `{taskId: targetIsDone}`, or null if empty. */
    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val data = prefs.getString(KEY_DONE_TASKS, null)
        if (data != null) {
            // Tap times stay: the push that follows this drain must not cut a
            // project widget's grace period short.
            prefs.edit().remove(KEY_DONE_TASKS).commit()
        }
        return data
    }
}
