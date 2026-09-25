package com.superproductivity.superproductivity.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/**
 * Durable on-device inbox for tasks captured natively (startup quick-add overlay).
 *
 * One immutable JSON file per capture: [add] returns only after the file is
 * fsynced and renamed into place, reads never delete, and the app acknowledges
 * an entry only after the task it created is persisted. The capture id becomes
 * the task id, so a redelivered entry is recognised instead of duplicated.
 * Lives in noBackupFilesDir so a device restore cannot replay old captures.
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
        return id
    }

    /**
     * Non-destructive read of all valid captures, oldest first, as a JSON array.
     * An unreadable file is skipped (and kept) so it cannot block later captures.
     */
    fun pendingJson(): String {
        val entries = synchronized(LOCK) {
            val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".json") }
                ?: return "[]"
            files.mapNotNull { parse(it) }
        }.sortedWith(compareBy({ it.optLong("createdAt") }, { it.optString("id") }))
        return JSONArray(entries).toString()
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
