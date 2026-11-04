package com.superproductivity.superproductivity.share

import android.content.Context

/**
 * The account's SuperSync capture public key (base64 SPKI), mirrored by the
 * app while capture is on. Plain SharedPreferences: the key is public, and
 * the share activity reads it on its hot path, where opening the
 * Keystore-backed credential store would cost a cold process 100 ms or more.
 * Cleared together with the SuperSync credentials, so its presence means
 * "upload shares".
 */
object CaptureKeyStore {
    private const val PREFS_NAME = "SuperProductivityCapture"
    private const val KEY_PUBLIC_KEY = "CAPTURE_PUBLIC_KEY"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** An empty key clears it. */
    fun set(context: Context, publicKeySpki: String) {
        val editor = prefs(context).edit()
        if (publicKeySpki.isEmpty()) {
            editor.remove(KEY_PUBLIC_KEY)
        } else {
            editor.putString(KEY_PUBLIC_KEY, publicKeySpki)
        }
        editor.apply()
    }

    fun get(context: Context): String? =
        prefs(context).getString(KEY_PUBLIC_KEY, null)?.takeIf { it.isNotEmpty() }
}
