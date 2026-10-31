package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * SharedPreferences-backed queues for tracking / focus-mode / remote-tracking
 * notification actions (#10683). The native side applies what it can at tap
 * time (NotificationActionReceiver); Angular drains these queues on startup,
 * resume and on a live "drain now" signal to bring the store in line. Same
 * pull-based pattern as [ReminderDoneQueue]: a cold-started WebView can't
 * receive pushes, but it can always pull.
 *
 * Entries carry only ids, timestamps and durations — never task titles.
 */
object NotificationActionQueue {
    private const val PREFS_NAME = "SuperProductivityNotificationActions"
    private const val KEY_TRACKING = "TRACKING_ACTIONS"
    private const val KEY_FOCUS = "FOCUS_ACTIONS"
    private const val KEY_REMOTE_STOP_AT = "REMOTE_STOP_AT"

    const val TRACKING_PAUSE = "PAUSE"
    const val TRACKING_DONE = "DONE"

    const val FOCUS_PAUSE = "PAUSE"
    const val FOCUS_RESUME = "RESUME"
    const val FOCUS_SKIP = "SKIP"
    const val FOCUS_COMPLETE = "COMPLETE"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /** [elapsedMs] is the native task total at [at], i.e. the time to credit. */
    @Synchronized
    fun addTrackingAction(context: Context, type: String, taskId: String, elapsedMs: Long, at: Long) {
        append(
            context,
            KEY_TRACKING,
            JSONObject()
                .put("type", type)
                .put("taskId", taskId)
                .put("elapsedMs", elapsedMs)
                .put("at", at)
        )
    }

    @Synchronized
    fun addFocusAction(context: Context, type: String, at: Long) {
        append(context, KEY_FOCUS, JSONObject().put("type", type).put("at", at))
    }

    /** Only the latest tap matters: a stop either still applies or has expired. */
    @Synchronized
    fun setRemoteStop(context: Context, at: Long) {
        getPrefs(context).edit().putLong(KEY_REMOTE_STOP_AT, at).commit()
    }

    @Synchronized
    fun getAndClearTracking(context: Context): String? = getAndClear(context, KEY_TRACKING)

    @Synchronized
    fun getAndClearFocus(context: Context): String? = getAndClear(context, KEY_FOCUS)

    @Synchronized
    fun getAndClearRemoteStop(context: Context): String? {
        val prefs = getPrefs(context)
        if (!prefs.contains(KEY_REMOTE_STOP_AT)) return null
        val at = prefs.getLong(KEY_REMOTE_STOP_AT, 0L)
        prefs.edit().remove(KEY_REMOTE_STOP_AT).commit()
        return at.toString()
    }

    private fun append(context: Context, key: String, entry: JSONObject) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(key, null)
        val array = if (existing != null) JSONArray(existing) else JSONArray()
        array.put(entry)
        prefs.edit().putString(key, array.toString()).commit()
    }

    private fun getAndClear(context: Context, key: String): String? {
        val prefs = getPrefs(context)
        val data = prefs.getString(key, null)
        if (data != null) {
            prefs.edit().remove(key).commit()
        }
        return data
    }
}
