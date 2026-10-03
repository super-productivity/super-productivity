package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed single-slot queue for a stop-tracking tap on the
 * live-tracking widget. Holds the id of the task the tap intended to stop, so
 * the drain side can CAS-guard against a stale queued stop touching whatever
 * is tracked by the time Angular next runs (task switched, or stopped and
 * restarted, since the tap) — same reasoning as the remote stop command's
 * sessionId guard in TrackingPresenceCmd.
 *
 * Angular is the only consumer (JavaScriptInterface.getWidgetTrackingStopQueue).
 */
object WidgetTrackingStopQueue {
    private const val PREFS_NAME = "SuperProductivityWidgetTrackingStop"
    private const val KEY_STOP_TASK_ID = "WIDGET_TRACKING_STOP_TASK_ID"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun request(context: Context, taskId: String) {
        // commit (not apply): the enqueue runs in a short-lived broadcast, the
        // process may be killed right after — the tap must survive that.
        getPrefs(context).edit().putString(KEY_STOP_TASK_ID, taskId).commit()
    }

    /** @return the queued task id, or null if empty. Clears the slot. */
    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val taskId = prefs.getString(KEY_STOP_TASK_ID, null)
        if (taskId != null) {
            prefs.edit().remove(KEY_STOP_TASK_ID).commit()
        }
        return taskId
    }
}
