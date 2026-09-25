package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import com.superproductivity.superproductivity.crypto.DerivedKeyCache
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
import org.json.JSONArray
import org.json.JSONException
import kotlin.io.encoding.Base64

/**
 * Builds the op-payload decryptor from the mirrored E2EE password, or null
 * when none is stored (E2EE password not yet mirrored, e.g. old JS bundle) —
 * callers then degrade to envelope-only parsing, i.e. pre-fix behavior.
 *
 * @param deriveOnMiss pass false from deadline-bound callers (BroadcastReceiver);
 *   see [OpPayloadDecryptor].
 */
fun buildPayloadDecryptor(
    context: Context,
    logTag: String,
    deriveOnMiss: Boolean = true,
): OpPayloadDecryptor? {
    val password = BackgroundSyncCredentialStore.getEncryptionPassword(context)
        ?.takeIf { it.isNotEmpty() }
        ?: return null
    return OpPayloadDecryptor(
        password = password,
        keyCache = SharedPrefsDerivedKeyCache(context),
        logWarn = { Log.w(logTag, it) },
        deriveOnMiss = deriveOnMiss,
    )
}

/**
 * Persists Argon2id-derived keys in [BackgroundSyncCredentialStore]'s
 * EncryptedSharedPreferences so the seconds-long KDF runs once per remote
 * session salt instead of on every worker wake-up. Stored as a JSON list of
 * [saltB64, keyB64] pairs under a single pref key; the store drops that key
 * whenever the E2EE password changes.
 */
class SharedPrefsDerivedKeyCache(context: Context) : DerivedKeyCache {

    companion object {
        private const val TAG = "DerivedKeyCache"

        /**
         * Each remote (device, process session) contributes one salt; a handful
         * of active devices is the realistic ceiling, so a small cap suffices.
         */
        private const val MAX_CACHED_KEYS = 12
    }

    private val appContext = context.applicationContext

    override fun get(saltB64: String): ByteArray? {
        val entries = readEntries()
        for (i in 0 until entries.length()) {
            val entry = entries.optJSONArray(i) ?: continue
            if (entry.optString(0) == saltB64) {
                return try {
                    Base64.decode(entry.optString(1))
                } catch (e: IllegalArgumentException) {
                    null
                }
            }
        }
        return null
    }

    override fun put(saltB64: String, key: ByteArray) {
        val entries = readEntries()
        val updated = JSONArray()
        // Newest first, truncated at the cap. put() only runs on a get() miss,
        // so a duplicate salt can only race in from concurrent callers — the
        // skip below keeps one copy.
        updated.put(JSONArray().put(saltB64).put(Base64.encode(key)))
        for (i in 0 until entries.length()) {
            if (updated.length() >= MAX_CACHED_KEYS) break
            val entry = entries.optJSONArray(i) ?: continue
            if (entry.optString(0) != saltB64) updated.put(entry)
        }
        BackgroundSyncCredentialStore.setDerivedKeyCacheRaw(appContext, updated.toString())
    }

    private fun readEntries(): JSONArray {
        val raw = BackgroundSyncCredentialStore.getDerivedKeyCacheRaw(appContext)
            ?: return JSONArray()
        return try {
            JSONArray(raw)
        } catch (e: JSONException) {
            Log.w(TAG, "Corrupt derived-key cache, resetting")
            JSONArray()
        }
    }
}
