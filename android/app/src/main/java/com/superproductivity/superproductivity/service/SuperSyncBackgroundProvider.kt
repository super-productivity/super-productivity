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

        // Action type codes for reminder-relevant actions.
        // These are abbreviations of NgRx action types defined in:
        //   src/app/op-log/core/action-types.enum.ts (full names)
        //   src/app/core/persistence/operation-log/compact/action-type-codes.ts (short codes)
        // If the frontend codes change, these must be updated to match.
        private const val ACTION_DISMISS_REMINDER = "HRX"       // TASK_SHARED_DISMISS_REMINDER
        private const val ACTION_MOVE_TO_ARCHIVE = "HX"         // TASK_SHARED_MOVE_TO_ARCHIVE
        private const val ACTION_CLEAR_DEADLINE_REMINDER = "HCR" // TASK_SHARED_CLEAR_DEADLINE_REMINDER
        private const val ACTION_DELETE_TASK = "HD"              // TASK_SHARED_DELETE

        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build()

        /**
         * Port of TypeScript generateNotificationId() from android-notification-id.util.ts.
         * Must produce identical output for the same input string.
         */
        fun generateNotificationId(reminderId: String): Int {
            var hash = 0
            for (char in reminderId) {
                hash = (hash shl 5) - hash + char.code
            }
            // Use toLong() before abs() to handle Int.MIN_VALUE correctly.
            // In Kotlin, abs(Int.MIN_VALUE) returns Int.MIN_VALUE (negative) due to overflow.
            // This must match the JS implementation where Math.abs works on 64-bit floats.
            return (abs(hash.toLong()) % 2147483647).toInt()
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
        val ops = json.optJSONArray("ops")
            ?: return ReminderChangeResult(emptySet(), json.optLong("latestSeq", 0L), false)
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
     *   d = entityId (single), ds = entityIds (batch),
     *   p = { actionPayload: {...}, entityChanges: [...] }
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

        // For UPD operations, check if the payload contains reminder-relevant field changes.
        // The payload structure is: p.entityChanges[] with per-entity changes,
        // and p.actionPayload with the original action payload.
        if (opType == "UPD") {
            val payload = op.optJSONObject("p") ?: return

            // Primary: check entityChanges array (always present, consistent structure).
            // Each entry has: { entityType, entityId, opType, changes: { isDone, remindAt, ... } }
            if (checkEntityChanges(payload, out)) return

            // Secondary: check actionPayload.task.changes for single-entity updates
            if (checkActionPayload(payload)) {
                collectEntityIds(op, out)
            }
        }
    }

    /**
     * Check the p.entityChanges array for reminder-relevant changes.
     * This is the most reliable source since it always has a consistent structure.
     * Returns true if any reminder-relevant changes were found.
     */
    private fun checkEntityChanges(payload: JSONObject, out: MutableSet<String>): Boolean {
        val entityChanges = payload.optJSONArray("entityChanges") ?: return false
        var found = false

        for (i in 0 until entityChanges.length()) {
            val entry = entityChanges.optJSONObject(i) ?: continue
            // Only check TASK entity changes
            if (entry.optString("entityType", "") != "TASK") continue

            val entityId = entry.optString("entityId", "")
            if (entityId.isEmpty()) continue

            val changes = entry.optJSONObject("changes") ?: continue
            if (isReminderRelevantChanges(changes)) {
                out.add(entityId)
                found = true
            }
        }
        return found
    }

    /**
     * Check p.actionPayload for reminder-relevant changes.
     * Structure: actionPayload.task.changes.{isDone, remindAt, deadlineRemindAt}
     */
    private fun checkActionPayload(payload: JSONObject): Boolean {
        val actionPayload = payload.optJSONObject("actionPayload") ?: return false
        val task = actionPayload.optJSONObject("task") ?: return false
        val changes = task.optJSONObject("changes") ?: return false
        return isReminderRelevantChanges(changes)
    }

    /**
     * Check if a changes object contains reminder-relevant field changes.
     */
    private fun isReminderRelevantChanges(changes: JSONObject): Boolean {
        if (changes.has("isDone") && changes.optBoolean("isDone", false)) return true
        if (changes.has("remindAt") && changes.isNull("remindAt")) return true
        if (changes.has("deadlineRemindAt") && changes.isNull("deadlineRemindAt")) return true
        return false
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
