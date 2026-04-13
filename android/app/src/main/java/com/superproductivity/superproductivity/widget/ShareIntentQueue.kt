package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed store for persisting share intent data across process death.
 * Uses commit() (synchronous) instead of apply() for crash safety during cold start.
 */
object ShareIntentQueue {
    private const val PREFS_NAME = "SuperProductivityShare"
    private const val KEY_PENDING_SHARE = "PENDING_SHARE_DATA"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /**
     * Persist share data. Uses commit() for synchronous write — survives process death.
     * Synchronized: called from UI thread (handleIntent) and JS thread (getPendingShareData).
     */
    @Synchronized
    fun setPending(context: Context, json: String) {
        getPrefs(context).edit().putString(KEY_PENDING_SHARE, json).commit()
    }

    /**
     * Read and atomically clear persisted share data. Uses commit() for synchronous write.
     * Synchronized: called from UI thread (flushPendingShareIntent) and JS thread (getPendingShareData).
     * @return JSON string of share data, or null if empty
     */
    @Synchronized
    fun getAndClear(context: Context): String? {
        val prefs = getPrefs(context)
        val data = prefs.getString(KEY_PENDING_SHARE, null)
        if (data != null) {
            prefs.edit().remove(KEY_PENDING_SHARE).commit()
        }
        return data
    }
}
