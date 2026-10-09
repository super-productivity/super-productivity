package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * SharedPreferences-backed single-slot queue for a stop-tracking tap on the
 * live-tracking widget. Holds the id of the task the tap intended to stop, so
 * the drain side can CAS-guard against a stale queued stop touching whatever
 * is tracked by the time Angular next runs (task switched, or stopped and
 * restarted, since the tap) — same reasoning as the remote stop command's
 * sessionId guard in TrackingPresenceCmd.
 *
 * Also holds the native counter's elapsed time frozen at the tap: the widget
 * stops the native service right away (the app's activity may be gone), so
 * that value is the session's authoritative total when Angular next runs.
 *
 * Angular is the only consumer (JavaScriptInterface.getWidgetTrackingStopQueue).
 */
object WidgetTrackingStopQueue {
    private const val PREFS_NAME = "SuperProductivityWidgetTrackingStop"
    private const val KEY_STOP_TASK_ID = "WIDGET_TRACKING_STOP_TASK_ID"
    private const val KEY_ELAPSED_MS = "WIDGET_TRACKING_STOP_ELAPSED_MS"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /** @param elapsedMs native total at the tap, or null if native wasn't tracking this task. */
    @Synchronized
    fun request(context: Context, taskId: String, elapsedMs: Long?) {
        // commit (not apply): the enqueue runs in a short-lived broadcast, the
        // process may be killed right after — the tap must survive that.
        val editor = getPrefs(context).edit().putString(KEY_STOP_TASK_ID, taskId)
        if (elapsedMs != null) {
            editor.putLong(KEY_ELAPSED_MS, elapsedMs)
        } else {
            editor.remove(KEY_ELAPSED_MS)
        }
        editor.commit()
    }

    /**
     * Hides a local [task] whose stop is queued but not yet drained, so both
     * widgets show "not tracking" right after the tap instead of waiting for
     * Angular's next snapshot push (which may be until the app is reopened).
     */
    @Synchronized
    fun withoutPendingStop(context: Context, task: WidgetCurrentTask?): WidgetCurrentTask? {
        val pendingTaskId = getPrefs(context).getString(KEY_STOP_TASK_ID, null)
        return task?.takeUnless { it.isLocal && it.id == pendingTaskId }
    }

    /**
     * @return `{"taskId":…,"elapsedMs":…|null}` for the queued stop, or null if
     * empty. Clears the slot.
     */
    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val taskId = prefs.getString(KEY_STOP_TASK_ID, null) ?: return null
        val elapsedMs = if (prefs.contains(KEY_ELAPSED_MS)) prefs.getLong(KEY_ELAPSED_MS, 0L) else null
        prefs.edit().remove(KEY_STOP_TASK_ID).remove(KEY_ELAPSED_MS).commit()
        return JSONObject()
            .put("taskId", taskId)
            .put("elapsedMs", elapsedMs ?: JSONObject.NULL)
            .toString()
    }
}
