package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * EncryptedSharedPreferences-backed store for background sync credentials.
 * Used by SyncReminderWorker to authenticate against the sync server.
 *
 * Uses AndroidX security-crypto (AES256) so the access token is not stored
 * in plaintext. Falls back to standard SharedPreferences if encryption setup
 * fails (e.g., on devices with broken KeyStore).
 *
 * lastServerSeq is stored per-account (keyed by baseUrl hash) to prevent
 * account-switching bugs where the old seq is used with new credentials.
 */
object BackgroundSyncCredentialStore {
    private const val TAG = "BgSyncCredStore"
    private const val PREFS_NAME = "SuperProductivitySync"
    private const val KEY_BASE_URL = "BASE_URL"
    private const val KEY_ACCESS_TOKEN = "ACCESS_TOKEN"
    private const val KEY_SEQ_PREFIX = "LAST_SERVER_SEQ_"

    data class Credentials(
        val baseUrl: String,
        val accessToken: String
    )

    private fun getPrefs(context: Context): SharedPreferences {
        return try {
            val masterKey = MasterKey.Builder(context.applicationContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context.applicationContext,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Fallback to standard SharedPreferences if KeyStore is broken
            Log.w(TAG, "EncryptedSharedPreferences unavailable, falling back to standard", e)
            context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    @Synchronized
    fun save(context: Context, baseUrl: String, accessToken: String) {
        val prefs = getPrefs(context)
        val previousToken = prefs.getString(KEY_ACCESS_TOKEN, null)
        val editor = prefs.edit()
            .putString(KEY_BASE_URL, baseUrl)
            .putString(KEY_ACCESS_TOKEN, accessToken)
        // Reset seq when access token changes (account switch on same server)
        if (previousToken != null && previousToken != accessToken) {
            editor.putLong(seqKey(baseUrl), 0L)
        }
        editor.commit()
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
