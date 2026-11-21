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
    private const val KEY_GENERATION = "GENERATION"

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

    @Synchronized
    fun saveState(context: Context, state: RepeatCfgSyncState) {
        prefs(context).edit().putString(KEY_STATE, encodeState(state).toString()).commit()
    }

    /** Bumped by every [replaceFromApp]; read it before [getState]. */
    fun getGeneration(context: Context): Long = prefs(context).getLong(KEY_GENERATION, 0L)

    /**
     * Saves a state folded from [getState] unless the app replaced the cache
     * since [generation] was read: its snapshot is the newer full list, so the
     * fold result is dropped and the caller continues from the snapshot.
     */
    @Synchronized
    fun saveStateIfUnchanged(context: Context, state: RepeatCfgSyncState, generation: Long): Boolean {
        if (getGeneration(context) != generation) return false
        saveState(context, state)
        return true
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

    /**
     * Replaces the cached configs with the open app's full list
     * (getRepeatCfgSnapshotForNative). Kept only while a background-sync login
     * is stored, as [clear] would drop it anyway. The worker's op cursor is
     * untouched, so it may re-fold ops the app already applied; config ops
     * end in the same state.
     */
    @Synchronized
    fun replaceFromApp(context: Context, json: String) {
        if (!BackgroundSyncCredentialStore.hasAnyCredentials(context)) return
        val state = parseAppSnapshot(json)
        if (state == null) {
            Log.w(TAG, "Repeat config snapshot unreadable, keeping cache")
            return
        }
        prefs(context).edit()
            .putString(KEY_STATE, encodeState(state).toString())
            .putLong(KEY_GENERATION, getGeneration(context) + 1)
            .commit()
    }

    /** Null on malformed input, so a bad bridge call never wipes the cache. */
    internal fun parseAppSnapshot(json: String): RepeatCfgSyncState? {
        val decoded = try {
            JSONObject(json)
        } catch (e: JSONException) {
            return null
        }
        val arr = decoded.optJSONArray("cfgs") ?: return null
        val cfgs = ArrayList<RepeatCfg>(arr.length())
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            RepeatCfg.fromJson(obj, complete = true)?.let { cfgs.add(it) }
        }
        return RepeatCfgSyncState(cfgs, readArchivedIds(decoded))
    }

    /** Keeps the generation counting up, so a run that read before the clear cannot save. */
    @Synchronized
    fun clear(context: Context) {
        val next = getGeneration(context) + 1
        prefs(context).edit().clear().putLong(KEY_GENERATION, next).commit()
    }

    internal fun encodeState(state: RepeatCfgSyncState): JSONObject = JSONObject().apply {
        put("cfgs", JSONArray().apply { state.cfgs.forEach { put(it.toJson()) } })
        put("archivedProjectIds", JSONArray(state.archivedProjectIds.toList()))
    }

    internal fun decodeState(json: JSONObject): RepeatCfgSyncState {
        val cfgs = ArrayList<RepeatCfg>()
        val arr = json.optJSONArray("cfgs")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                RepeatCfg.fromJson(obj, complete = false)?.let { cfgs.add(it) }
            }
        }
        return RepeatCfgSyncState(cfgs, readArchivedIds(json))
    }

    private fun readArchivedIds(json: JSONObject): Set<String> {
        val archived = HashSet<String>()
        val ids = json.optJSONArray("archivedProjectIds") ?: return archived
        for (i in 0 until ids.length()) {
            val id = ids.optString(i, "")
            if (id.isNotEmpty()) archived.add(id)
        }
        return archived
    }
}
