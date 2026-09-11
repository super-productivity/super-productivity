package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.annotation.VisibleForTesting
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
    private const val KEY_ENCRYPTION_PASSWORD = "ENCRYPTION_PASSWORD"
    private const val KEY_DERIVED_KEY_CACHE = "DERIVED_KEY_CACHE"

    data class Credentials(
        val baseUrl: String,
        val accessToken: String
    )

    // Created once per process: EncryptedSharedPreferences.create() does
    // Keystore work on every call, which adds up now that the derived-key
    // cache reads go through here. All access is via @Synchronized methods,
    // so a plain field is safe.
    private var prefs: SharedPreferences? = null

    /**
     * Drops the process-lifetime cache so the next call re-opens the store —
     * what the instrumented tests need to stand in for a fresh process on a
     * migrated device.
     *
     * Exists because doing this by reflection does not survive minification:
     * R8 renames the backing field, and `getDeclaredField("prefs")` is a string
     * it never rewrites. Instrumented tests run on the minified r8Test variant.
     */
    @VisibleForTesting
    @Synchronized
    fun forgetCachedPrefsForTest() {
        prefs = null
    }

    private fun getPrefs(context: Context): SharedPreferences {
        prefs?.let { return it }
        return createPrefs(context).also { prefs = it }
    }

    private fun createPrefs(context: Context): SharedPreferences {
        return try {
            createEncryptedPrefs(context)
        } catch (e: Exception) {
            // The master key is device-bound and lives in the Android Keystore,
            // which neither cloud backup nor device-to-device transfer carries
            // over. A migrated install therefore holds a keyset it can never
            // unwrap, and Tink throws out of create() rather than returning
            // empty. Falling straight through to the plaintext store below
            // would then write the access token and the E2EE password to disk
            // in the clear, on every device the user migrates to — so discard
            // the unreadable file and mint a fresh encrypted store first. The
            // WebView re-supplies the credentials on the next foreground sync.
            Log.w(TAG, "Encrypted store unreadable, discarding it", e)
            context.applicationContext.deleteSharedPreferences(PREFS_NAME)
            try {
                createEncryptedPrefs(context)
            } catch (e2: Exception) {
                // Fallback to standard SharedPreferences if KeyStore is broken
                Log.w(TAG, "EncryptedSharedPreferences unavailable, falling back to standard", e2)
                context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            }
        }
    }

    private fun createEncryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
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
            .remove(KEY_ENCRYPTION_PASSWORD)
            .remove(KEY_DERIVED_KEY_CACHE)
            .commit()
    }

    /**
     * Mirrors the E2EE password so the background worker can decrypt op
     * payloads (SuperSync encrypts payloads end-to-end since #8670); an empty
     * password clears it. Cached derived keys are password-dependent, so any
     * change also drops the key cache — this method is the single owner of
     * that invariant.
     */
    @Synchronized
    fun setEncryptionPassword(context: Context, password: String) {
        val prefs = getPrefs(context)
        if ((prefs.getString(KEY_ENCRYPTION_PASSWORD, null) ?: "") == password) return
        val editor = prefs.edit().remove(KEY_DERIVED_KEY_CACHE)
        if (password.isEmpty()) {
            editor.remove(KEY_ENCRYPTION_PASSWORD)
        } else {
            editor.putString(KEY_ENCRYPTION_PASSWORD, password)
        }
        editor.commit()
    }

    @Synchronized
    fun getEncryptionPassword(context: Context): String? {
        return getPrefs(context).getString(KEY_ENCRYPTION_PASSWORD, null)
    }

    /** Raw persisted derived-key cache; the format is owned by [SharedPrefsDerivedKeyCache]. */
    @Synchronized
    fun getDerivedKeyCacheRaw(context: Context): String? {
        return getPrefs(context).getString(KEY_DERIVED_KEY_CACHE, null)
    }

    @Synchronized
    fun setDerivedKeyCacheRaw(context: Context, value: String) {
        getPrefs(context).edit().putString(KEY_DERIVED_KEY_CACHE, value).commit()
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
