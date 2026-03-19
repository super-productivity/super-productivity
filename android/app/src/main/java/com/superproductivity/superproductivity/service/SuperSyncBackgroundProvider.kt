package com.superproductivity.superproductivity.service

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * SuperSync implementation of BackgroundSyncProvider.
 * Fetches operations from the SuperSync server and parses them
 * for reminder-relevant changes (task done, deleted, reminder cleared, archived).
 */
class SuperSyncBackgroundProvider : BackgroundSyncProvider {

    companion object {
        private const val TAG = "SuperSyncBgProvider"

        // Action type codes for reminder-relevant actions
        private const val ACTION_DISMISS_REMINDER = "HRX"       // TASK_SHARED_DISMISS_REMINDER
        private const val ACTION_MOVE_TO_ARCHIVE = "HX"         // TASK_SHARED_MOVE_TO_ARCHIVE
        private const val ACTION_CLEAR_DEADLINE_REMINDER = "HCR" // TASK_SHARED_CLEAR_DEADLINE_REMINDER
        private const val ACTION_DELETE_TASK = "HD"              // TASK_SHARED_DELETE

        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        /**
         * Port of TypeScript generateNotificationId() from android-notification-id.util.ts.
         * Must produce identical output for the same input string.
         */
        fun generateNotificationId(reminderId: String): Int {
            var hash = 0
            for (char in reminderId) {
                hash = (hash shl 5) - hash + char.code
                hash = hash and hash // Keep as 32-bit integer
            }
            return abs(hash) % 2147483647
        }
    }

    override suspend fun fetchReminderChanges(
        baseUrl: String,
        accessToken: String,
        lastSeq: Long,
        limit: Int
    ): ReminderChangeResult? {
        val url = "${baseUrl.trimEnd('/')}/api/sync/ops?sinceSeq=$lastSeq&limit=$limit"
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .header("Accept", "application/json")
            .header("Accept-Encoding", "gzip")
            .get()
            .build()

        return try {
            val response = httpClient.newCall(request).execute()
            response.use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "HTTP ${resp.code} from $baseUrl")
                    return null
                }
                val body = resp.body?.string() ?: return null
                parseResponse(body)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to fetch ops from $baseUrl", e)
            null
        }
    }

    private fun parseResponse(body: String): ReminderChangeResult {
        val json = JSONObject(body)
        val ops = json.getJSONArray("ops")
        val hasMore = json.optBoolean("hasMore", false)
        val latestSeq = json.optLong("latestSeq", 0L)
        val taskIds = mutableSetOf<String>()

        for (i in 0 until ops.length()) {
            val op = ops.getJSONObject(i)
            extractReminderRelevantTaskIds(op, taskIds)
        }

        return ReminderChangeResult(
            taskIdsToCancel = taskIds,
            latestSeq = latestSeq,
            hasMore = hasMore
        )
    }

    /**
     * Extracts task IDs from an operation if it represents a reminder-relevant change.
     * Compact operation format:
     *   a = actionType code, o = opType, e = entityType,
     *   d = entityId (single), ds = entityIds (batch), p = payload
     */
    private fun extractReminderRelevantTaskIds(op: JSONObject, out: MutableSet<String>) {
        val entityType = op.optString("e", "")
        if (entityType != "TASK") return

        val actionType = op.optString("a", "")
        val opType = op.optString("o", "")

        // Action-based detection: these actions always mean the reminder should be cancelled
        when (actionType) {
            ACTION_DISMISS_REMINDER,
            ACTION_MOVE_TO_ARCHIVE,
            ACTION_CLEAR_DEADLINE_REMINDER,
            ACTION_DELETE_TASK -> {
                collectEntityIds(op, out)
                return
            }
        }

        // Delete operations always cancel reminders
        if (opType == "DEL") {
            collectEntityIds(op, out)
            return
        }

        // For UPD operations, check if the payload contains reminder-relevant field changes
        if (opType == "UPD") {
            if (isReminderRelevantUpdate(op)) {
                collectEntityIds(op, out)
                return
            }
            // Also check BATCH entityChanges in payload
            checkBatchEntityChanges(op, out)
        }
    }

    /**
     * Check if an UPD operation's payload indicates a reminder-relevant change.
     * The payload structure varies by action type, but we look for common patterns.
     */
    private fun isReminderRelevantUpdate(op: JSONObject): Boolean {
        val payload = op.optJSONObject("p") ?: return false

        // Direct payload fields (for simple task updates)
        if (payload.has("isDone") && payload.optBoolean("isDone", false)) return true
        if (payload.has("remindAt") && payload.isNull("remindAt")) return true
        if (payload.has("deadlineRemindAt") && payload.isNull("deadlineRemindAt")) return true

        // Nested under task.changes (for TASK_SHARED_UPDATE / "HU" actions)
        val task = payload.optJSONObject("task")
        if (task != null) {
            val changes = task.optJSONObject("changes") ?: task
            if (changes.has("isDone") && changes.optBoolean("isDone", false)) return true
            if (changes.has("remindAt") && changes.isNull("remindAt")) return true
            if (changes.has("deadlineRemindAt") && changes.isNull("deadlineRemindAt")) return true
        }

        return false
    }

    /**
     * For BATCH operations, the payload may contain an entityChanges array
     * with per-entity changes.
     */
    private fun checkBatchEntityChanges(op: JSONObject, out: MutableSet<String>) {
        val payload = op.optJSONObject("p") ?: return
        val entityChanges = payload.optJSONArray("entityChanges") ?: return

        for (i in 0 until entityChanges.length()) {
            val change = entityChanges.optJSONObject(i) ?: continue
            val entityId = change.optString("id", "").ifEmpty {
                change.optString("entityId", "")
            }
            if (entityId.isEmpty()) continue

            // Check if this entity change is reminder-relevant
            if (change.has("isDone") && change.optBoolean("isDone", false)) {
                out.add(entityId)
            }
            if (change.has("remindAt") && change.isNull("remindAt")) {
                out.add(entityId)
            }
            if (change.has("deadlineRemindAt") && change.isNull("deadlineRemindAt")) {
                out.add(entityId)
            }
        }
    }

    private fun collectEntityIds(op: JSONObject, out: MutableSet<String>) {
        // Single entity ID
        val entityId = op.optString("d", "")
        if (entityId.isNotEmpty()) {
            out.add(entityId)
        }
        // Batch entity IDs
        val entityIds = op.optJSONArray("ds")
        if (entityIds != null) {
            for (i in 0 until entityIds.length()) {
                val id = entityIds.optString(i, "")
                if (id.isNotEmpty()) {
                    out.add(id)
                }
            }
        }
    }
}
