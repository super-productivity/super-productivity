package com.superproductivity.superproductivity.service

import android.util.Log
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
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
 * IMPORTANT: The op-log system returns empty entityChanges for task actions
 * (only time-tracking ops populate it — see operation-capture.service.ts), so
 * reminder data comes from actionPayload. This provider matches on actionType
 * to know each payload's shape; an action type missing here means reminders it
 * sets on another device only reach this phone once the app is opened.
 *
 * SuperSync encrypts op payloads end-to-end (mandatory since #8670), so the
 * payload arrives as a base64 string, not JSON. [payloadDecryptor] makes those
 * readable; without one (no E2EE password mirrored yet, e.g. old JS bundle)
 * only the plaintext envelope fields (actionType/opType/entityId) are usable —
 * cancels still work, schedules are skipped. The parameter has no default on
 * purpose: passing null silently degrades to that envelope-only mode, so every
 * construction site must make it an explicit decision (use
 * [buildPayloadDecryptor]).
 */
class SuperSyncBackgroundProvider(
    private val payloadDecryptor: OpPayloadDecryptor?,
) : BackgroundSyncProvider {

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

        // Actions whose payload carries task fields (remindAt, isDone, ...) as a
        // patch or snapshot. See [extractTaskPatches] for each payload shape.
        private const val ACTION_ADD_TASK = "[Task Shared] addTask"
        private const val ACTION_UPDATE_TASK = "[Task Shared] updateTask"
        private const val ACTION_UPDATE_TASKS = "[Task Shared] updateTasks"
        private const val ACTION_APPLY_SHORT_SYNTAX = "[Task Shared] applyShortSyntax"
        // Synthetic conflict-resolution op: toLwwUpdateActionType('TASK') in packages/sync-core
        private const val ACTION_TASK_LWW_UPDATE = "[TASK] LWW Update"

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

    internal fun parseResponse(body: String): ReminderChangeResult {
        val json = JSONObject(body)
        val ops = json.optJSONArray("ops")
            ?: return ReminderChangeResult(emptySet(), emptyList(), json.optLong("latestSeq", 0L), false)
        val hasMore = json.optBoolean("hasMore", false)
        // latestSeq is the server's global watermark, not the end of this page.
        // The worker must request the remaining ops before persisting that watermark.
        val latestSeq = if (hasMore) {
            ops.getJSONObject(ops.length() - 1).getLong("serverSeq")
        } else {
            json.optLong("latestSeq", 0L)
        }
        val now = System.currentTimeMillis()

        // Keyed by (taskId, isDeadline) so later ops naturally overwrite earlier ones
        val reminderMap = mutableMapOf<Pair<String, Boolean>, ReminderToSchedule>()
        // Tasks whose alarms are all cancelled before their collected reminders
        // are scheduled. Ops are in server sequence order, so processing forward
        // ensures the latest op wins: dismiss-then-reschedule keeps only the reschedule.
        val taskIdsToCancel = mutableSetOf<String>()
        val unreadableTaskIds = mutableSetOf<String>()

        for (i in 0 until ops.length()) {
            val serverOp = ops.getJSONObject(i)
            val op = serverOp.getJSONObject("op")
            // Lazy so envelope-only ops (e.g. DEL) never pay for decryption
            val payload = lazy(LazyThreadSafetyMode.NONE) { resolvePayload(op) }

            val tempMap = mutableMapOf<Pair<String, Boolean>, ReminderToSchedule>()
            extractRemindersToSchedule(op, payload, tempMap, now)
            val cancelIds = mutableSetOf<String>()
            extractReminderRelevantTaskIds(op, payload, cancelIds)
            // Needed but undecryptable (no key for its salt yet): the alarm
            // receiver can't trust a "not stale" answer for these tasks.
            if (payload.isInitialized() && payload.value == null && op.opt("payload") is String) {
                collectEntityIds(op, unreadableTaskIds)
            }

            for (id in cancelIds) {
                taskIdsToCancel.add(id)
                // A cancel clears every alarm slot of the task, so reminders
                // collected from earlier ops are stale: drop them, or a later
                // schedule of the other slot (e.g. setDeadline) would revive them.
                reminderMap.keys.removeAll { it.first == id }
            }
            for ((key, reminder) in tempMap) {
                reminderMap[key] = reminder
                // A schedule supersedes an EARLIER op's cancel. The same op's
                // cancel stays: it clears the slot this op does not set, e.g. an
                // LWW snapshot that sets remindAt and lists the absent
                // deadlineRemindAt in clearedFields. Done ops schedule nothing.
                if (reminder.taskId !in cancelIds) taskIdsToCancel.remove(reminder.taskId)
            }
        }

        return ReminderChangeResult(
            taskIdsToCancel = taskIdsToCancel,
            remindersToSchedule = reminderMap.values.toList(),
            latestSeq = latestSeq,
            hasMore = hasMore,
            unreadableTaskIds = unreadableTaskIds,
        )
    }

    /**
     * Resolves an op's payload to usable JSON: either the plaintext object
     * directly, or — since payload E2EE became mandatory — the decrypted
     * base64 string. Returns null when there is no payload or it can't be
     * read (no decryptor, wrong password, corrupt data); callers then fall
     * back to the plaintext envelope fields only.
     */
    private fun resolvePayload(op: JSONObject): JSONObject? {
        // Discriminates by JSON type (object = plaintext, string = encrypted)
        // rather than the op's isPayloadEncrypted flag — equivalent for every
        // shipped format and robust when the optional flag is absent.
        op.optJSONObject("payload")?.let { return it }
        val decryptor = payloadDecryptor ?: return null
        val encrypted = op.opt("payload") as? String ?: return null
        val decrypted = decryptor.decrypt(encrypted) ?: return null
        return try {
            JSONObject(decrypted)
        } catch (e: org.json.JSONException) {
            Log.w(TAG, "Decrypted payload is not a JSON object, skipping op")
            null
        }
    }

    /**
     * Extracts task IDs from an operation if it represents a reminder-relevant change.
     * Server operation format:
     *   actionType = full NgRx action string, opType = "CRT"/"UPD"/"DEL",
     *   entityType = "TASK"/"PROJECT"/etc.,
     *   entityId = single ID, entityIds = batch IDs,
     *   payload = { actionPayload: {...}, entityChanges: [...] } (encrypted: base64 string)
     */
    private fun extractReminderRelevantTaskIds(
        op: JSONObject,
        payloadLazy: Lazy<JSONObject?>,
        out: MutableSet<String>
    ) {
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
            val payload = payloadLazy.value ?: return

            // Primary: check entityChanges array (always present, consistent structure).
            // Each entry has: { entityType, entityId, opType, changes: { isDone, remindAt, ... } }
            if (checkEntityChanges(payload, out)) return

            // Secondary: task fields carried in actionPayload (updateTask, updateTasks,
            // applyShortSyntax, LWW Update)
            for (patch in extractTaskPatches(actionType, payload)) {
                if (isCancellingPatch(patch)) out.add(patch.taskId)
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
     * Task fields carried by one op for one task.
     *
     * @param fields the changed fields (a patch) or the whole task (a snapshot)
     * @param isSnapshot true when absent fields mean "cleared", i.e. a full
     *   replacement of the task (LWW Update in replace mode)
     * @param clearedFields fields cleared out-of-band (LWW patch `clearedFields`,
     *   because JSON drops undefined-valued keys — #9776)
     */
    private data class TaskPatch(
        val taskId: String,
        val fields: JSONObject,
        val title: String,
        val isSnapshot: Boolean = false,
        val clearedFields: Set<String> = emptySet(),
    )

    /**
     * Maps the reminder-carrying payload shapes of task actions to [TaskPatch]es.
     * Shapes (src/app/root-store/meta/task-shared.actions.ts):
     *   addTask:          { task: Task }
     *   updateTask:       { task: { id, changes } }
     *   updateTasks:      { tasks: [{ id, changes }] }
     *   applyShortSyntax: { task: Task, taskChanges, schedulingInfo?: { remindAt? } }
     *   [TASK] LWW Update: payload { actionPayload: Task | Partial<Task>, lwwUpdateMode, clearedFields? }
     */
    private fun extractTaskPatches(actionType: String, payload: JSONObject): List<TaskPatch> {
        val actionPayload = payload.optJSONObject("actionPayload") ?: return emptyList()
        return when (actionType) {
            ACTION_ADD_TASK -> {
                val task = actionPayload.optJSONObject("task") ?: return emptyList()
                val id = task.optString("id", "")
                if (id.isEmpty()) emptyList()
                else listOf(TaskPatch(id, task, task.optString("title", "")))
            }
            ACTION_UPDATE_TASK -> {
                val task = actionPayload.optJSONObject("task") ?: return emptyList()
                listOfNotNull(updateToPatch(task))
            }
            ACTION_UPDATE_TASKS -> {
                val tasks = actionPayload.optJSONArray("tasks") ?: return emptyList()
                (0 until tasks.length()).mapNotNull { i -> tasks.optJSONObject(i)?.let(::updateToPatch) }
            }
            ACTION_APPLY_SHORT_SYNTAX -> {
                val task = actionPayload.optJSONObject("task") ?: return emptyList()
                val id = task.optString("id", "")
                if (id.isEmpty()) return emptyList()
                // Copy so merging schedulingInfo never mutates the parsed payload
                val changes = JSONObject(actionPayload.optJSONObject("taskChanges")?.toString() ?: "{}")
                // Mirrors short-syntax-shared.reducer.ts: schedulingInfo.remindAt is
                // applied only together with dueWithTime and only as a value
                // (`remindAt ?? undefined`) — null or day-only planning never clears
                // the task's reminder, so neither may cancel the alarm here.
                val schedulingInfo = actionPayload.optJSONObject("schedulingInfo")
                if (schedulingInfo != null &&
                    hasTimestamp(schedulingInfo, "dueWithTime") &&
                    hasTimestamp(schedulingInfo, "remindAt")
                ) {
                    changes.put("remindAt", schedulingInfo.optLong("remindAt"))
                }
                val title = changes.optString("title", "").ifEmpty { task.optString("title", "") }
                listOf(TaskPatch(id, changes, title))
            }
            ACTION_TASK_LWW_UPDATE -> {
                val id = actionPayload.optString("id", "")
                if (id.isEmpty()) return emptyList()
                val cleared = payload.optJSONArray("clearedFields")
                    ?.let { arr -> (0 until arr.length()).map { arr.optString(it, "") }.toSet() }
                    ?: emptySet()
                listOf(
                    TaskPatch(
                        id,
                        actionPayload,
                        actionPayload.optString("title", ""),
                        isSnapshot = payload.optString("lwwUpdateMode", "") == "replace",
                        clearedFields = cleared,
                    )
                )
            }
            else -> emptyList()
        }
    }

    private fun updateToPatch(update: JSONObject): TaskPatch? {
        val id = update.optString("id", "")
        val changes = update.optJSONObject("changes") ?: return null
        if (id.isEmpty()) return null
        return TaskPatch(id, changes, changes.optString("title", ""))
    }

    /**
     * True when the patch means the task's reminders must go: it is marked done,
     * or its reminder is cleared — explicitly (null), out-of-band (clearedFields),
     * or by a snapshot that no longer carries any reminder.
     */
    private fun isCancellingPatch(patch: TaskPatch): Boolean {
        if (isReminderRelevantChanges(patch.fields)) return true
        if ("remindAt" in patch.clearedFields || "deadlineRemindAt" in patch.clearedFields) return true
        return patch.isSnapshot &&
            !hasTimestamp(patch.fields, "remindAt") &&
            !hasTimestamp(patch.fields, "deadlineRemindAt")
    }

    private fun hasTimestamp(obj: JSONObject, key: String): Boolean =
        obj.has(key) && !obj.isNull(key) && obj.optLong(key, 0L) > 0L

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
     * Three detection paths:
     * 1. entityChanges — kept for payloads that populate it (the op-log currently
     *    returns empty entityChanges for task actions).
     * 2. task fields in actionPayload — addTask, updateTask(s), applyShortSyntax
     *    (e.g. "Call mom @15:00" typed on desktop) and LWW Update (see [extractTaskPatches]).
     * 3. actionPayload — for schedule/reschedule/setDeadline actions where the
     *    reminder data sits at the payload top level.
     */
    private fun extractRemindersToSchedule(
        op: JSONObject,
        payloadLazy: Lazy<JSONObject?>,
        out: MutableMap<Pair<String, Boolean>, ReminderToSchedule>,
        now: Long
    ) {
        val entityType = op.optString("entityType", "")
        if (entityType != "TASK") return

        val opType = op.optString("opType", "")
        // Only CRT and UPD operations can create/update reminders
        if (opType != "CRT" && opType != "UPD") return

        val payload = payloadLazy.value ?: return
        val actionType = op.optString("actionType", "")

        // Path 1: Check entityChanges (for payloads that populate it)
        val entityChanges = payload.optJSONArray("entityChanges")
        if (entityChanges != null) {
            for (i in 0 until entityChanges.length()) {
                val entry = entityChanges.optJSONObject(i) ?: continue
                if (entry.optString("entityType", "") != "TASK") continue

                val entityId = entry.optString("entityId", "")
                if (entityId.isEmpty()) continue

                val changes = entry.optJSONObject("changes") ?: continue
                // A done task gets no alarm; its cancel comes from the same op
                if (changes.optBoolean("isDone", false)) continue

                val title = changes.optString("title", "").ifEmpty {
                    payload.optJSONObject("actionPayload")
                        ?.optJSONObject("task")
                        ?.optString("title", "")
                        ?: ""
                }.ifEmpty { "Task reminder" }

                if (changes.has("remindAt") && !changes.isNull("remindAt")) {
                    val remindAt = changes.optLong("remindAt", 0L)
                    if (remindAt > now) {
                        out[Pair(entityId, false)] = ReminderToSchedule(entityId, title, remindAt, isDeadline = false)
                    }
                }

                if (changes.has("deadlineRemindAt") && !changes.isNull("deadlineRemindAt")) {
                    val deadlineRemindAt = changes.optLong("deadlineRemindAt", 0L)
                    if (deadlineRemindAt > now) {
                        out[Pair(entityId, true)] = ReminderToSchedule(entityId, title, deadlineRemindAt, isDeadline = true)
                    }
                }
            }
        }

        // Path 2: task fields in actionPayload (addTask, updateTask(s), applyShortSyntax,
        // LWW Update). A done task gets no alarm — its cancel wins in parseResponse anyway.
        for (patch in extractTaskPatches(actionType, payload)) {
            if (patch.fields.optBoolean("isDone", false)) continue
            val title = patch.title.ifEmpty { "Task reminder" }
            if (hasTimestamp(patch.fields, "remindAt")) {
                val remindAt = patch.fields.optLong("remindAt", 0L)
                if (remindAt > now) {
                    out[Pair(patch.taskId, false)] = ReminderToSchedule(patch.taskId, title, remindAt, isDeadline = false)
                }
            }
            if (hasTimestamp(patch.fields, "deadlineRemindAt")) {
                val deadlineRemindAt = patch.fields.optLong("deadlineRemindAt", 0L)
                if (deadlineRemindAt > now) {
                    out[Pair(patch.taskId, true)] = ReminderToSchedule(patch.taskId, title, deadlineRemindAt, isDeadline = true)
                }
            }
        }

        // Path 3: Check actionPayload for schedule/setDeadline actions.
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
                        out[Pair(taskId, false)] = ReminderToSchedule(taskId, title, remindAt, isDeadline = false)
                    }
                }
            }
            ACTION_SET_DEADLINE -> {
                val taskId = actionPayload.optString("taskId", "")
                if (taskId.isEmpty()) return

                if (actionPayload.has("deadlineRemindAt") && !actionPayload.isNull("deadlineRemindAt")) {
                    val deadlineRemindAt = actionPayload.optLong("deadlineRemindAt", 0L)
                    if (deadlineRemindAt > now) {
                        out[Pair(taskId, true)] = ReminderToSchedule(taskId, "Task reminder", deadlineRemindAt, isDeadline = true)
                    }
                }
            }
        }
    }
}
