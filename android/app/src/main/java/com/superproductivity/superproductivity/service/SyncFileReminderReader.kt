package com.superproductivity.superproductivity.service

import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
import java.io.ByteArrayInputStream
import java.io.Reader
import java.io.StringReader
import java.util.zip.GZIPInputStream
import kotlin.io.encoding.Base64

/** Outcome of reading one v2 sync file (sync-data.json). */
sealed interface SyncFileReadResult {
    /**
     * Every reminder slot in the file, past ones included: a slot that is
     * gone means its alarm or shown notification is stale, a slot that is
     * merely past is not.
     */
    data class Reminders(
        val reminders: List<ReminderToSchedule>,
        /**
         * Open tasks with a due day but no reminder time: the app may hold a
         * due-day alarm for them (mobile-notification.effects.ts). Its time
         * depends on app config, so the worker only ever cancels it.
         */
        val dueDayTaskIds: Set<String> = emptySet(),
    ) : SyncFileReadResult

    /** The file could not be trusted or understood. [reason] never holds user content. */
    data class Unreadable(val reason: String) : SyncFileReadResult
}

/**
 * Reads the reminders out of a WebDAV/Nextcloud v2 sync file without the
 * WebView. Mirrors the app's decode path (encrypt-and-compress-handler.service.ts):
 * `pf_[C][E]<modelVersion>__` prefix, then decrypt (same wire format as
 * SuperSync op payloads), then base64 gzip, then JSON. The JSON is streamed so
 * the archives — usually the bulk of the file — are skipped, never built.
 *
 * Which tasks count mirrors selectAllTasksWithReminder /
 * selectAllTasksWithDeadlineReminder: not done, not in an archived project.
 * Archived tasks live outside `state.task`, so they drop out by construction.
 */
object SyncFileReminderReader {
    private val PREFIX_REGEX = Regex("^pf_(C)?(E)?(\\d+(?:\\.\\d+)?)__")
    private val NON_BASE64 = Regex("[^A-Za-z0-9+/=]")
    private const val SPLIT_FORMAT_VERSION = 3

    private class TaskFields(
        val id: String,
        val title: String,
        val remindAt: Long?,
        val deadlineRemindAt: Long?,
        val isDone: Boolean,
        val projectId: String?,
        val hasDueDay: Boolean,
    )

    private class StateFields(
        var version: Int? = null,
        var tasks: List<TaskFields>? = null,
        val archivedProjectIds: MutableSet<String> = mutableSetOf(),
    )

    fun read(
        body: String,
        decryptor: OpPayloadDecryptor?,
        isEncryptionExpected: Boolean,
    ): SyncFileReadResult {
        val match = PREFIX_REGEX.find(body) ?: return SyncFileReadResult.Unreadable("prefix")
        val isCompressed = match.groupValues[1].isNotEmpty()
        val isEncrypted = match.groupValues[2].isNotEmpty()
        // The E flag sits outside the AEAD envelope (GHSA-vrc7-775g-ggqc):
        // local intent decides, or a tampered file could inject reminders.
        if (isEncryptionExpected && !isEncrypted) return SyncFileReadResult.Unreadable("plaintext")

        var data = body.substring(match.value.length)
        if (isEncrypted) {
            if (decryptor == null) return SyncFileReadResult.Unreadable("no-password")
            data = decryptor.decrypt(data) ?: return SyncFileReadResult.Unreadable("decrypt")
        }

        val state = try {
            openReader(data, isCompressed).use { parseFile(JsonReader(it)) }
        } catch (e: Exception) {
            // Corrupt gzip/base64/JSON; the message may quote content, so drop it
            return SyncFileReadResult.Unreadable("parse:${e.javaClass.simpleName}")
        }
        if (state.version == SPLIT_FORMAT_VERSION) return SyncFileReadResult.Unreadable("split-format")
        // No task state means a shape this reader does not know — treating it
        // as "no reminders" would cancel every alarm.
        val tasks = state.tasks ?: return SyncFileReadResult.Unreadable("no-task-state")
        val openTasks = tasks.filter { !it.isDone && it.projectId !in state.archivedProjectIds }
        return SyncFileReadResult.Reminders(
            toReminders(openTasks),
            openTasks.filter { it.hasDueDay && it.remindAt == null }.mapTo(HashSet()) { it.id },
        )
    }

    private fun openReader(data: String, isCompressed: Boolean): Reader {
        if (!isCompressed) return StringReader(data)
        // Same leniency as the app's sanitizeBase64 (compression.ts)
        val cleaned = data.replace(NON_BASE64, "")
        val sanitized = when (cleaned.length % 4) {
            0 -> cleaned
            1 -> cleaned.dropLast(1)
            else -> cleaned + "=".repeat(4 - cleaned.length % 4)
        }
        val bytes = Base64.decode(sanitized)
        return GZIPInputStream(ByteArrayInputStream(bytes)).reader(Charsets.UTF_8)
    }

    private fun toReminders(openTasks: List<TaskFields>): List<ReminderToSchedule> {
        val out = mutableListOf<ReminderToSchedule>()
        for (task in openTasks) {
            val title = task.title.ifEmpty { "Task reminder" }
            task.remindAt?.let { out.add(ReminderToSchedule(task.id, title, it, isDeadline = false)) }
            task.deadlineRemindAt?.let { out.add(ReminderToSchedule(task.id, title, it, isDeadline = true)) }
        }
        return out
    }

    private fun parseFile(reader: JsonReader): StateFields {
        val out = StateFields()
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "version" -> out.version = readIntOrNull(reader)
                "state" -> parseState(reader, out)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return out
    }

    private fun parseState(reader: JsonReader, out: StateFields) {
        if (reader.peek() != JsonToken.BEGIN_OBJECT) return reader.skipValue()
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "task" -> out.tasks = readEntities(reader, ::parseTask)?.filterNotNull()
                "project" -> readEntities(reader, ::parseArchivedProjectId)
                    ?.filterNotNull()
                    ?.let { out.archivedProjectIds.addAll(it) }
                else -> reader.skipValue()
            }
        }
        reader.endObject()
    }

    /** Reads `{ entities: { id: {...} } }` (NgRx entity state); null if absent. */
    private fun <T> readEntities(reader: JsonReader, parseEntity: (JsonReader) -> T?): List<T?>? {
        if (reader.peek() != JsonToken.BEGIN_OBJECT) {
            reader.skipValue()
            return null
        }
        var entities: MutableList<T?>? = null
        reader.beginObject()
        while (reader.hasNext()) {
            if (reader.nextName() != "entities" || reader.peek() != JsonToken.BEGIN_OBJECT) {
                reader.skipValue()
                continue
            }
            val list = mutableListOf<T?>()
            reader.beginObject()
            while (reader.hasNext()) {
                reader.nextName()
                if (reader.peek() == JsonToken.BEGIN_OBJECT) list.add(parseEntity(reader)) else reader.skipValue()
            }
            reader.endObject()
            entities = list
        }
        reader.endObject()
        return entities
    }

    private fun parseTask(reader: JsonReader): TaskFields? {
        var id = ""
        var title = ""
        var remindAt: Long? = null
        var deadlineRemindAt: Long? = null
        var isDone = false
        var projectId: String? = null
        var hasDueDay = false
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = readStringOrNull(reader) ?: ""
                "title" -> title = readStringOrNull(reader) ?: ""
                "remindAt" -> remindAt = readTimestampOrNull(reader)
                "deadlineRemindAt" -> deadlineRemindAt = readTimestampOrNull(reader)
                "isDone" -> isDone = readBooleanOrFalse(reader)
                "projectId" -> projectId = readStringOrNull(reader)
                "dueDay" -> hasDueDay = !readStringOrNull(reader).isNullOrEmpty()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        if (id.isEmpty()) return null
        return TaskFields(id, title, remindAt, deadlineRemindAt, isDone, projectId, hasDueDay)
    }

    private fun parseArchivedProjectId(reader: JsonReader): String? {
        var id = ""
        var isArchived = false
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "id" -> id = readStringOrNull(reader) ?: ""
                "isArchived" -> isArchived = readBooleanOrFalse(reader)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        return id.takeIf { isArchived && it.isNotEmpty() }
    }

    private fun readStringOrNull(reader: JsonReader): String? {
        if (reader.peek() == JsonToken.STRING) return reader.nextString()
        reader.skipValue()
        return null
    }

    private fun readBooleanOrFalse(reader: JsonReader): Boolean {
        if (reader.peek() == JsonToken.BOOLEAN) return reader.nextBoolean()
        reader.skipValue()
        return false
    }

    private fun readIntOrNull(reader: JsonReader): Int? {
        if (reader.peek() == JsonToken.NUMBER) return reader.nextDouble().toInt()
        reader.skipValue()
        return null
    }

    /** Like the app's `typeof remindAt === 'number'`, plus > 0 to skip the 0 sentinel. */
    private fun readTimestampOrNull(reader: JsonReader): Long? {
        if (reader.peek() != JsonToken.NUMBER) {
            reader.skipValue()
            return null
        }
        return reader.nextDouble().toLong().takeIf { it > 0L }
    }
}
