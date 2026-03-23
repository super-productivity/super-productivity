package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * SharedPreferences-backed store for persisting scheduled alarm parameters.
 * Used by BootReceiver to re-register alarms after device reboot.
 */
object ReminderAlarmStore {
    private const val TAG = "ReminderAlarmStore"
    private const val PREFS_NAME = "SuperProductivityAlarms"
    private const val KEY_ALARMS = "SCHEDULED_ALARMS"

    data class AlarmData(
        val notificationId: Int,
        val reminderId: String,
        val relatedId: String,
        val title: String,
        val reminderType: String,
        val triggerAtMs: Long,
        val useAlarmStyle: Boolean,
        val isOngoing: Boolean
    )

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun save(
        context: Context,
        notificationId: Int,
        reminderId: String,
        relatedId: String,
        title: String,
        reminderType: String,
        triggerAtMs: Long,
        useAlarmStyle: Boolean,
        isOngoing: Boolean
    ) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_ALARMS, null)
        val array = if (existing != null) JSONArray(existing) else JSONArray()

        // Remove existing entry with same notificationId (update case)
        val filtered = JSONArray()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            if (obj.getInt("notificationId") != notificationId) {
                filtered.put(obj)
            }
        }

        val entry = JSONObject().apply {
            put("notificationId", notificationId)
            put("reminderId", reminderId)
            put("relatedId", relatedId)
            put("title", title)
            put("reminderType", reminderType)
            put("triggerAtMs", triggerAtMs)
            put("useAlarmStyle", useAlarmStyle)
            put("isOngoing", isOngoing)
        }
        filtered.put(entry)

        prefs.edit().putString(KEY_ALARMS, filtered.toString()).commit()
    }

    @Synchronized
    fun remove(context: Context, notificationId: Int) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_ALARMS, null) ?: return
        val array = JSONArray(existing)

        val filtered = JSONArray()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            if (obj.getInt("notificationId") != notificationId) {
                filtered.put(obj)
            }
        }

        prefs.edit().putString(KEY_ALARMS, filtered.toString()).commit()
    }

    @Synchronized
    fun getAll(context: Context): List<AlarmData> {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_ALARMS, null) ?: return emptyList()
        val array = JSONArray(existing)
        val now = System.currentTimeMillis()
        val result = mutableListOf<AlarmData>()
        val futureEntries = JSONArray()

        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            val triggerAtMs = obj.getLong("triggerAtMs")
            // Auto-cleanup: skip entries in the past
            if (triggerAtMs <= now) {
                Log.d(TAG, "Cleaning up past alarm: ${obj.getString("title")}")
                continue
            }
            futureEntries.put(obj)
            result.add(
                AlarmData(
                    notificationId = obj.getInt("notificationId"),
                    reminderId = obj.getString("reminderId"),
                    relatedId = obj.getString("relatedId"),
                    title = obj.getString("title"),
                    reminderType = obj.getString("reminderType"),
                    triggerAtMs = triggerAtMs,
                    useAlarmStyle = obj.optBoolean("useAlarmStyle", false),
                    isOngoing = obj.optBoolean("isOngoing", false)
                )
            )
        }

        // Persist cleaned-up list
        if (futureEntries.length() != array.length()) {
            prefs.edit().putString(KEY_ALARMS, futureEntries.toString()).commit()
        }

        return result
    }

    @Synchronized
    fun clear(context: Context) {
        getPrefs(context).edit().remove(KEY_ALARMS).commit()
    }
}
