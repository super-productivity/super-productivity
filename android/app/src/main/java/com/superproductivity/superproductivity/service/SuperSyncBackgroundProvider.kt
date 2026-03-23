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
 * for reminder-relevant changes (scheduled, unscheduled, done, deleted, archived).
 *
 * IMPORTANT: The op-log system returns empty entityChanges for most actions —
 * only TIME_TRACKING and CRT (addTask) ops populate it. For schedule/unschedule/
 * deadline actions, the actual data is in actionPayload. This provider uses
 * action-type matching to handle both paths.
 */
class SuperSyncBackgroundProvider : BackgroundSyncProvider {

    companion object {
        private const val TAG = "SuperSyncBgProvider"

        // Full NgRx action type strings for reminder-relevant actions.
        // Defined in: src/app/op-log/core/action-types.enum.ts
        // The SuperSync server returns these full strings (not compact codes).
        // If the frontend action types change, these must be updated to match.
        private const val ACTION_DISMISS_REMINDER = "[Task Shared] dismissReminderOnly"
        private const val ACTION_MOVE_TO_ARCHIVE = "[Task Shared] moveToArchive"
        private const val ACTION_CLEAR_DEADLINE_REMINDER = "[Task Shared] clearDeadlineReminder"
        private const val ACTION_DELETE_TASK = "[Task Shared] deleteTask"
        private const val ACTION_UNSCHEDULE = "[Task Shared] unscheduleTask"
        private const val ACTION_REMOVE_DEADLINE = "[Task Shared] removeDeadline"

        // Actions that carry scheduling data in actionPayload (not entityChanges).
        // The op-log returns empty entityChanges for these — the actual changes
        // (remindAt, deadlineRemindAt) are only in actionPayload.
        private const val ACTION_SCHEDULE_WITH_TIME = "[Task Shared] scheduleTaskWithTime"
        private const val ACTION_RESCHEDULE_WITH_TIME = "[Task Shared] reScheduleTaskWithTime"
        private const val ACTION_SET_DEADLINE = "[Task Shared] setDeadline"

        private val httpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build()

        /** Tight-timeout client for BroadcastReceiver checks that must complete within goAsync()'s ~10s window. */
        private val quickHttpClient = httpClient.newBuilder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
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
        return doFetch(httpClient, baseUrl, accessToken, lastSeq, limit)
    }

    /**
     * Same as [fetchReminderChanges] but with tight OkHttp timeouts (5s total).
     * Use from BroadcastReceivers where goAsync() limits total execution time to ~10s.
     * OkHttp's own callTimeout enforces the deadline — unlike coroutine cancellation,
     * this actually interrupts the blocking I/O.
     */
    suspend fun fetchQuick(
        baseUrl: String,
        accessToken: String,
        lastSeq: Long,
        limit: Int = 100
    ): ReminderChangeResult? {
        return doFetch(quickHttpClient, baseUrl, accessToken, lastSeq, limit)
    }

    private suspend fun doFetch(
        client: OkHttpClient,
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
            val response = client.newCall(request).execute()
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
            ?: return ReminderChangeResult(emptySet(), emptyList(), json.optLong("latestSeq", 0L), false)
        val hasMore = json.optBoolean("hasMore", false)
        val latestSeq = json.optLong("latestSeq", 0L)
        val now = System.currentTimeMillis()

        // Keyed by (taskId, isDueDate) so later ops naturally overwrite earlier ones
        val reminderMap = mutableMapOf<Pair<String, Boolean>, ReminderToSchedule>()
        // Per-task: tracks whether the LAST op affecting this task was a cancel or a schedule.
        // Ops are in server sequence order, so processing forward ensures the latest op wins.
        // This handles dismiss-then-reschedule: the reschedule (later op) takes precedence.
        val taskLastAction = mutableMapOf<String, String>()

        for (i in 0 until ops.length()) {
            val serverOp = ops.getJSONObject(i)
            val op = serverOp.getJSONObject("op")

            // Process schedules first so that within the same op, cancels take precedence
            val tempMap = mutableMapOf<Pair<String, Boolean>, ReminderToSchedule>()
            extractRemindersToSchedule(op, tempMap, now)
            for ((key, reminder) in tempMap) {
                reminderMap[key] = reminder
                taskLastAction[reminder.taskId] = "schedule"
            }

            val cancelIds = mutableSetOf<String>()
            extractReminderRelevantTaskIds(op, cancelIds)
            for (id in cancelIds) {
                taskLastAction[id] = "cancel"
            }
        }

        val taskIdsToCancel = taskLastAction
            .filter { it.value == "cancel" }
            .keys
            .toSet()
        val reminders = reminderMap.values.filter { taskLastAction[it.taskId] == "schedule" }

        return ReminderChangeResult(
            taskIdsToCancel = taskIdsToCancel,
            remindersToSchedule = reminders,
            latestSeq = latestSeq,
            hasMore = hasMore
        )
    }

    /**
     * Extracts task IDs from an operation if it represents a reminder-relevant change.
     * Server operation format:
     *   actionType = full NgRx action string, opType = "CRT"/"UPD"/"DEL",
     *   entityType = "TASK"/"PROJECT"/etc.,
     *   entityId = single ID, entityIds = batch IDs,
     *   payload = { actionPayload: {...}, entityChanges: [...] }
     */
    private fun extractReminderRelevantTaskIds(op: JSONObject, out: MutableSet<String>) {
        val entityType = op.optString("entityType", "")
        if (entityType != "TASK") return

        val actionType = op.optString("actionType", "")
        val opType = op.optString("opType", "")

        // Action-based detection: these actions always mean the reminder should be cancelled.
        // NOTE: Most of these actions produce empty entityChanges in the op-log
        // (the op-log system only populates entityChanges for TIME_TRACKING actions).
        // That's why we match on actionType strings rather than inspecting field changes.
        when (actionType) {
            ACTION_DISMISS_REMINDER,
            ACTION_MOVE_TO_ARCHIVE,
            ACTION_CLEAR_DEADLINE_REMINDER,
            ACTION_DELETE_TASK,
            ACTION_UNSCHEDULE,
            ACTION_REMOVE_DEADLINE -> {
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
        // The payload structure is: payload.entityChanges[] with per-entity changes,
        // and payload.actionPayload with the original action payload.
        if (opType == "UPD") {
            val payload = op.optJSONObject("payload") ?: return

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
        val entityId = op.optString("entityId", "")
        if (entityId.isNotEmpty()) {
            out.add(entityId)
        }
        // Batch entity IDs
        val entityIds = op.optJSONArray("entityIds")
        if (entityIds != null) {
            for (i in 0 until entityIds.length()) {
                val id = entityIds.optString(i, "")
                if (id.isNotEmpty()) {
                    out.add(id)
                }
            }
        }
    }

    /**
     * Extracts reminders to schedule from an operation.
     *
     * Two detection paths:
     * 1. entityChanges — populated for CRT ops (addTask) where the full entity is in changes.
     * 2. actionPayload — for schedule/reschedule/setDeadline actions where the op-log
     *    returns empty entityChanges and the reminder data is only in the action payload.
     */
    private fun extractRemindersToSchedule(op: JSONObject, out: MutableMap<Pair<String, Boolean>, ReminderToSchedule>, now: Long) {
        val entityType = op.optString("entityType", "")
        if (entityType != "TASK") return

        val opType = op.optString("opType", "")
        // Only CRT and UPD operations can create/update reminders
        if (opType != "CRT" && opType != "UPD") return

        val payload = op.optJSONObject("payload") ?: return
        val actionType = op.optString("actionType", "")

        // Path 1: Check entityChanges (populated for CRT/addTask ops)
        val entityChanges = payload.optJSONArray("entityChanges")
        if (entityChanges != null) {
            for (i in 0 until entityChanges.length()) {
                val entry = entityChanges.optJSONObject(i) ?: continue
                if (entry.optString("entityType", "") != "TASK") continue

                val entityId = entry.optString("entityId", "")
                if (entityId.isEmpty()) continue

                val changes = entry.optJSONObject("changes") ?: continue

                val title = changes.optString("title", "").ifEmpty {
                    payload.optJSONObject("actionPayload")
                        ?.optJSONObject("task")
                        ?.optString("title", "")
                        ?: ""
                }.ifEmpty { "Task reminder" }

                if (changes.has("remindAt") && !changes.isNull("remindAt")) {
                    val remindAt = changes.optLong("remindAt", 0L)
                    if (remindAt > now) {
                        out[Pair(entityId, false)] = ReminderToSchedule(entityId, title, remindAt, isDueDate = false)
                    }
                }

                if (changes.has("deadlineRemindAt") && !changes.isNull("deadlineRemindAt")) {
                    val deadlineRemindAt = changes.optLong("deadlineRemindAt", 0L)
                    if (deadlineRemindAt > now) {
                        out[Pair(entityId, true)] = ReminderToSchedule(entityId, title, deadlineRemindAt, isDueDate = true)
                    }
                }
            }
        }

        // Path 2: Check actionPayload for schedule/setDeadline actions.
        // These actions have empty entityChanges — the reminder fields are in actionPayload.
        // scheduleTaskWithTime / reScheduleTaskWithTime payload:
        //   { task: { id, title, ... }, dueWithTime: number, remindAt?: number, ... }
        // setDeadline payload:
        //   { taskId: string, deadlineRemindAt?: number, ... }
        val actionPayload = payload.optJSONObject("actionPayload") ?: return

        when (actionType) {
            ACTION_SCHEDULE_WITH_TIME,
            ACTION_RESCHEDULE_WITH_TIME -> {
                val taskObj = actionPayload.optJSONObject("task") ?: return
                val taskId = taskObj.optString("id", "")
                if (taskId.isEmpty()) return

                if (actionPayload.has("remindAt") && !actionPayload.isNull("remindAt")) {
                    val remindAt = actionPayload.optLong("remindAt", 0L)
                    if (remindAt > now) {
                        val title = taskObj.optString("title", "").ifEmpty { "Task reminder" }
                        out[Pair(taskId, false)] = ReminderToSchedule(taskId, title, remindAt, isDueDate = false)
                    }
                }
            }
            ACTION_SET_DEADLINE -> {
                val taskId = actionPayload.optString("taskId", "")
                if (taskId.isEmpty()) return

                if (actionPayload.has("deadlineRemindAt") && !actionPayload.isNull("deadlineRemindAt")) {
                    val deadlineRemindAt = actionPayload.optLong("deadlineRemindAt", 0L)
                    if (deadlineRemindAt > now) {
                        out[Pair(taskId, true)] = ReminderToSchedule(taskId, "Task reminder", deadlineRemindAt, isDueDate = true)
                    }
                }
            }
        }
    }
}
