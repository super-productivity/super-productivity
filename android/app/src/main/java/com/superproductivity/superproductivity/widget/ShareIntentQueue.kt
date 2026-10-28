package com.superproductivity.superproductivity.widget

import android.content.Context
import com.superproductivity.superproductivity.share.SharePayload
import org.json.JSONObject
import java.util.UUID

/**
 * Legacy SharedPreferences slot where an older app version kept a share that
 * arrived before the web app was ready. Kept only to move such a share into
 * the [CaptureInbox], where shares now live.
 */
object ShareIntentQueue {
    private const val PREFS_NAME = "SuperProductivityShare"
    private const val KEY_PENDING_SHARE = "PENDING_SHARE_DATA"

    /**
     * Copies the legacy share into [inbox], then clears the slot. The entry id
     * is derived from the stored JSON, so re-running after a crash between the
     * two steps overwrites the same entry instead of adding a second one.
     */
    @Synchronized
    fun migrateInto(context: Context, inbox: CaptureInbox) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_PENDING_SHARE, null) ?: return
        val payload = parseLegacy(json)
        if (payload != null) {
            val id = UUID.nameUUIDFromBytes(json.toByteArray(Charsets.UTF_8)).toString()
            inbox.addShare(payload, isUpload = false, id = id)
        }
        prefs.edit().remove(KEY_PENDING_SHARE).commit()
    }

    /** `{ title, subject, type, path }` as the old CapacitorMainActivity stored it. */
    fun parseLegacy(json: String): JSONObject? {
        val legacy = try {
            JSONObject(json)
        } catch (e: Exception) {
            return null
        }
        return SharePayload.build(
            text = legacy.optString("path"),
            subject = legacy.optString("subject"),
            title = legacy.optString("title"),
            createdAt = System.currentTimeMillis(),
        )
    }
}
