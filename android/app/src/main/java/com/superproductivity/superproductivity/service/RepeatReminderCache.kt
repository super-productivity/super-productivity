package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Schedule fields and the repeat-alarm slots this worker last armed.
 *
 * Plain prefs, like the reminder settings: titles are already stored for
 * other alarms, and this holds no notes. Cleared when no background-sync
 * credentials remain, when the SuperSync access token changes, and when the
 * WebDAV file URL changes. A file snapshot is kept when switching onto
 * SuperSync with no previous token, so the next op page can update it
 * instead of starting from nothing.
 */
internal object RepeatReminderCache {
    private const val TAG = "RepeatReminderCache"
    private const val PREFS_NAME = "SuperProductivityRepeatReminders"
    private const val KEY_STATE = "STATE"
    private const val KEY_SLOTS = "SLOTS"
    private const val KEY_SLOTS_KNOWN = "SLOTS_KNOWN"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getState(context: Context): RepeatCfgSyncState {
        val raw = prefs(context).getString(KEY_STATE, null) ?: return RepeatCfgSyncState.EMPTY
        return try {
            decodeState(JSONObject(raw))
        } catch (e: JSONException) {
            Log.w(TAG, "Stored repeat configs unreadable, starting empty")
            RepeatCfgSyncState.EMPTY
        }
    }

    fun saveState(context: Context, state: RepeatCfgSyncState) {
        prefs(context).edit().putString(KEY_STATE, encodeState(state).toString()).commit()
    }

    /** Null until this worker has armed repeat alarms once. */
    fun getSlots(context: Context): Map<String, Long>? {
        val p = prefs(context)
        if (!p.getBoolean(KEY_SLOTS_KNOWN, false)) return null
        val raw = p.getString(KEY_SLOTS, null) ?: return emptyMap()
        return try {
            val json = JSONObject(raw)
            json.keys().asSequence().associateWith { json.getLong(it) }
        } catch (e: JSONException) {
            Log.w(TAG, "Stored repeat slots unreadable, leaving alarms untouched")
            null
        }
    }

    fun saveSlots(context: Context, slots: Map<String, Long>) {
        prefs(context).edit()
            .putBoolean(KEY_SLOTS_KNOWN, true)
            .putString(KEY_SLOTS, JSONObject(slots).toString())
            .commit()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().commit()
    }

    private fun encodeState(state: RepeatCfgSyncState): JSONObject = JSONObject().apply {
        put("cfgs", JSONArray().apply { state.cfgs.forEach { put(it.toJson()) } })
        put("archivedProjectIds", JSONArray(state.archivedProjectIds.toList()))
    }

    private fun decodeState(json: JSONObject): RepeatCfgSyncState {
        val cfgs = ArrayList<RepeatCfg>()
        val arr = json.optJSONArray("cfgs")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                RepeatCfg.fromJson(obj, complete = false)?.let { cfgs.add(it) }
            }
        }
        val archived = HashSet<String>()
        val ids = json.optJSONArray("archivedProjectIds")
        if (ids != null) {
            for (i in 0 until ids.length()) {
                val id = ids.optString(i, "")
                if (id.isNotEmpty()) archived.add(id)
            }
        }
        return RepeatCfgSyncState(cfgs, archived)
    }
}
