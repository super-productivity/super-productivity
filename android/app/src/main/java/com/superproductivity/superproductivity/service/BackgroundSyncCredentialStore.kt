package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed store for background sync credentials.
 * Used by SyncReminderWorker to authenticate against the sync server.
 *
 * lastServerSeq is stored per-account (keyed by baseUrl hash) to prevent
 * account-switching bugs where the old seq is used with new credentials.
 */
object BackgroundSyncCredentialStore {
    private const val PREFS_NAME = "SuperProductivitySync"
    private const val KEY_BASE_URL = "BASE_URL"
    private const val KEY_ACCESS_TOKEN = "ACCESS_TOKEN"
    private const val KEY_SEQ_PREFIX = "LAST_SERVER_SEQ_"

    data class Credentials(
        val baseUrl: String,
        val accessToken: String
    )

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Synchronized
    fun save(context: Context, baseUrl: String, accessToken: String) {
        getPrefs(context).edit()
            .putString(KEY_BASE_URL, baseUrl)
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .commit()
    }

    @Synchronized
    fun get(context: Context): Credentials? {
        val prefs = getPrefs(context)
        val baseUrl = prefs.getString(KEY_BASE_URL, null) ?: return null
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null
        if (baseUrl.isEmpty() || accessToken.isEmpty()) return null
        return Credentials(baseUrl, accessToken)
    }

    @Synchronized
    fun clear(context: Context) {
        getPrefs(context).edit()
            .remove(KEY_BASE_URL)
            .remove(KEY_ACCESS_TOKEN)
            .commit()
    }

    @Synchronized
    fun getLastServerSeq(context: Context, baseUrl: String): Long {
        return getPrefs(context).getLong(seqKey(baseUrl), 0L)
    }

    @Synchronized
    fun setLastServerSeq(context: Context, baseUrl: String, seq: Long) {
        getPrefs(context).edit()
            .putLong(seqKey(baseUrl), seq)
            .commit()
    }

    private fun seqKey(baseUrl: String): String {
        return KEY_SEQ_PREFIX + baseUrl.hashCode()
    }
}
