package com.superproductivity.superproductivity.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/**
 * Durable on-device inbox for tasks captured natively: Android shares
 * ([addShare]) and title-only captures ([add]) from the widget's quick add
 * ([QuickAddActivity]) or left by the removed startup quick-add overlay of an
 * older app version.
 *
 * One JSON file per capture: writes return only after the file is fsynced and
 * renamed into place, reads never delete, and the app acknowledges an entry
 * only after the task it created is persisted. The capture id becomes the
 * task id, so a redelivered entry is recognised instead of duplicated. Lives
 * in noBackupFilesDir so a device restore cannot replay old captures.
 *
 * A share entry waiting for its SuperSync upload carries `upload: "pending"`
 * and belongs to the upload ([ShareUploader]) until it is uploaded (deleted),
 * handed back ([releaseUpload]) or taken over by the app ([takeOverUploads]).
 * `sendingAt` marks a request in flight, so the app does not import an
 * entry while its request is open. After a client timeout the server may
 * still have stored it; a takeover then imports it too (a documented
 * duplicate, plan 2026-10-24). These state changes rewrite the file
 * atomically under [LOCK].
 */
class CaptureInbox(private val dir: File) {

    /** @return the capture id; throws if the capture could not be stored. */
    fun add(
        title: String,
        source: String,
        createdAt: Long = System.currentTimeMillis(),
        id: String = UUID.randomUUID().toString(),
    ): String {
        val trimmed = title.trim()
        require(trimmed.isNotEmpty()) { "Blank capture title" }
        require(isValidId(id)) { "Invalid capture id" }
        synchronized(LOCK) {
            if (!dir.isDirectory && !dir.mkdirs()) {
                throw IOException("Could not create capture inbox")
            }
            val json = JSONObject()
                .put("v", VERSION)
                .put("id", id)
                .put("title", trimmed)
                .put("source", source)
                .put("createdAt", createdAt)
            write(id, json)
        }
        return id
    }

    /**
     * Stores a share ([com.superproductivity.superproductivity.share.SharePayload]).
     * @param isUpload hand it to the SuperSync upload first
     * @return the capture id; throws if the capture could not be stored.
     */
    fun addShare(
        payload: JSONObject,
        isUpload: Boolean,
        id: String = UUID.randomUUID().toString(),
    ): String {
        require(payload.optString("title").isNotBlank()) { "Blank capture title" }
        require(isValidId(id)) { "Invalid capture id" }
        val json = JSONObject(payload.toString())
            .put("v", VERSION)
            .put("id", id)
            .put("source", SOURCE_SHARE)
        if (isUpload) json.put(KEY_UPLOAD, UPLOAD_PENDING)
        synchronized(LOCK) {
            if (!dir.isDirectory && !dir.mkdirs()) {
                throw IOException("Could not create capture inbox")
            }
            write(id, json)
        }
        return id
    }

    /**
     * Non-destructive read of the title-only captures, oldest first, as a JSON
     * array. Share entries are left out: a web bundle that only knows title
     * captures (legacy online mode loads a remote one) would import a share as
     * a bare title, or while it is still uploading.
     * An unreadable file is skipped (and kept) so it cannot block later captures.
     */
    fun pendingJson(): String =
        JSONArray(entries().filter { it.optString("source") != SOURCE_SHARE }).toString()

    /**
     * Non-destructive read of the share entries the app may import: every
     * share not owned by its upload. Call [takeOverUploads] first.
     */
    fun pendingSharesJson(): String =
        JSONArray(
            entries().filter {
                it.optString("source") == SOURCE_SHARE && !it.has(KEY_UPLOAD)
            },
        ).toString()

    /**
     * The app is open: it imports waiting uploads itself (the task then syncs
     * as an ordinary op). Skips entries with a request in flight.
     * @return the ids taken over, whose upload work can be cancelled
     */
    fun takeOverUploads(now: Long = System.currentTimeMillis()): List<String> =
        synchronized(LOCK) {
            entries()
                .filter { it.has(KEY_UPLOAD) && !isSending(it, now) }
                .map { entry ->
                    val id = entry.getString("id")
                    entry.remove(KEY_UPLOAD)
                    entry.remove(KEY_SENDING_AT)
                    write(id, entry)
                    id
                }
        }

    sealed interface UploadStart {
        /** Uploaded, imported, handed to the app, or never an upload. */
        object Done : UploadStart

        /** Another attempt is in flight; try again later. */
        object Busy : UploadStart

        class Ready(val entry: JSONObject) : UploadStart
    }

    /**
     * Starts one upload attempt: marks the entry as in flight if it is still
     * waiting for its upload and no other attempt holds it.
     */
    fun beginUpload(id: String, now: Long = System.currentTimeMillis()): UploadStart {
        if (!isValidId(id)) return UploadStart.Done
        synchronized(LOCK) {
            val entry = parse(File(dir, "$id.json")) ?: return UploadStart.Done
            if (!entry.has(KEY_UPLOAD)) return UploadStart.Done
            if (isSending(entry, now)) return UploadStart.Busy
            entry.put(KEY_SENDING_AT, now)
            write(id, entry)
            return UploadStart.Ready(entry)
        }
    }

    /** Ends an attempt that will be retried: the next one may start at once. */
    fun endUploadAttempt(id: String) = update(id) { it.remove(KEY_SENDING_AT) }

    /** The upload gives up (capture off, refused): the app imports it. */
    fun releaseUpload(id: String) = update(id) {
        it.remove(KEY_UPLOAD)
        it.remove(KEY_SENDING_AT)
    }

    private fun update(id: String, change: (JSONObject) -> Unit) {
        if (!isValidId(id)) return
        synchronized(LOCK) {
            val entry = parse(File(dir, "$id.json")) ?: return
            change(entry)
            write(id, entry)
        }
    }

    private fun isSending(entry: JSONObject, now: Long): Boolean {
        val sendingAt = entry.optLong(KEY_SENDING_AT, 0L)
        return sendingAt > 0 && now - sendingAt in 0 until SEND_LEASE_MS
    }

    private fun entries(): List<JSONObject> = synchronized(LOCK) {
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".json") }
            ?: return emptyList()
        files.mapNotNull { parse(it) }
    }.sortedWith(compareBy({ it.optLong("createdAt") }, { it.optString("id") }))

    /** Fsynced temp file renamed over the entry: a reader sees the old or the new one. */
    private fun write(id: String, json: JSONObject) {
        val tmp = File(dir, "$id.tmp")
        FileOutputStream(tmp).use { out ->
            out.write(json.toString().toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        if (!tmp.renameTo(File(dir, "$id.json"))) {
            tmp.delete()
            throw IOException("Could not commit capture")
        }
    }

    /** Deletes one capture. Returns true if it is gone (including already gone). */
    fun acknowledge(id: String): Boolean {
        if (!isValidId(id)) return false
        synchronized(LOCK) {
            val file = File(dir, "$id.json")
            return !file.exists() || file.delete()
        }
    }

    private fun parse(file: File): JSONObject? = try {
        val json = JSONObject(file.readText(Charsets.UTF_8))
        val id = json.optString("id")
        val isValid = json.optInt("v") == VERSION &&
            isValidId(id) &&
            file.name == "$id.json" &&
            json.optString("title").isNotBlank()
        if (isValid) json else null
    } catch (e: Exception) {
        null
    }

    companion object {
        const val VERSION = 1
        const val SOURCE_SHARE = "share"
        const val SOURCE_WIDGET = "widget"
        private const val KEY_UPLOAD = "upload"
        private const val UPLOAD_PENDING = "pending"
        private const val KEY_SENDING_AT = "sendingAt"

        /** Longer than any request ([ShareUploader] times out after 15 s). */
        const val SEND_LEASE_MS = 60_000L
        private const val DIR_NAME = "capture-inbox"
        private val LOCK = Any()
        private val ID_REGEX =
            Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

        fun forContext(context: Context): CaptureInbox =
            CaptureInbox(File(context.applicationContext.noBackupFilesDir, DIR_NAME))

        /** Ids cross the JS bridge and become file names; accept canonical UUIDs only. */
        fun isValidId(id: String): Boolean = ID_REGEX.matches(id)
    }
}
