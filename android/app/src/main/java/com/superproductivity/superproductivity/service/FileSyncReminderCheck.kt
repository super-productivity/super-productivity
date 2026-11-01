package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import androidx.work.ListenableWorker
import okhttp3.OkHttpClient
import okhttp3.Request
import okio.BufferedSource
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val TAG = "FileSyncReminderCheck"

// shortcut: whole file in memory, capped — stream it into the reader if real
// files outgrow the cap. Archives make up most of a large file.
internal const val MAX_SYNC_FILE_BYTES = 10L * 1024 * 1024

private val httpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .callTimeout(120, TimeUnit.SECONDS)
    .build()

/**
 * What one file read changes: single alarms to cancel (their reminder ids),
 * tasks whose alarms all go (gone, done or archived), alarms to (re)schedule,
 * and the slots to remember for the next diff. Due-day-only tasks get a slot
 * at time 0, so they are diffed like the others but never scheduled.
 */
internal data class ReminderSlotPlan(
    val reminderIdsToCancel: Set<String>,
    val taskIdsToCancel: Set<String>,
    val toSchedule: List<ReminderToSchedule>,
    val slots: Map<String, Long>,
)

/**
 * Diffs the reminder slots of the file against those of the last processed
 * read. Without a previous read nothing is cancelled: alarms the app set for
 * reminders this worker never saw are not its to judge.
 */
internal fun planReminderSlots(
    previous: Map<String, Long>?,
    file: SyncFileReadResult.Reminders,
    now: Long,
): ReminderSlotPlan {
    val current = file.reminders
    val slots = current.associateBy({ reminderIdOf(it) }, { it.remindAt }) +
        file.dueDayTaskIds.associate { dueDayReminderIdOf(it) to 0L }
    if (previous == null) return ReminderSlotPlan(emptySet(), emptySet(), current.filter { it.remindAt > now }, slots)

    val changed = current.filter { previous[reminderIdOf(it)] != it.remindAt }
    // Past slots are kept for the diff but not scheduled: they already fired.
    // One moved into the past still has its old alarm pending, so cancel that.
    val movedIntoPast = changed.filter { it.remindAt <= now && reminderIdOf(it) in previous }
    val toCancel = (previous.keys - slots.keys) + movedIntoPast.map { reminderIdOf(it) }
    val currentTaskIds = current.mapTo(HashSet()) { it.taskId } + file.dueDayTaskIds
    val tasksGone = toCancel.map(::taskIdOfReminderId).filterTo(HashSet()) { it !in currentTaskIds }
    val singleCancels = toCancel.filterTo(HashSet()) { taskIdOfReminderId(it) !in tasksGone }
    return ReminderSlotPlan(singleCancels, tasksGone, changed.filter { it.remindAt > now }, slots)
}

internal fun parseReminderSlots(raw: String?): Map<String, Long>? {
    raw ?: return null
    return try {
        val json = JSONObject(raw)
        json.keys().asSequence().associateWith { json.getLong(it) }
    } catch (e: JSONException) {
        Log.w(TAG, "Stored reminder slots unreadable, starting a new baseline")
        null
    }
}

/**
 * One background check of a WebDAV/Nextcloud sync file: download it when its
 * ETag changed, then cancel and schedule alarms by diffing its reminders
 * against the previous read. Read-only toward the server.
 */
internal fun runFileSyncReminderCheck(
    context: Context,
    credentials: BackgroundSyncCredentialStore.FileSyncCredentials,
): ListenableWorker.Result {
    val settings = BackgroundReminderSettingsStore.get(context)
    // Re-enabling reminders in the app reschedules all of them, and the
    // baseline stays as it was, so skipping here loses nothing.
    if (settings.isDisabled) return ListenableWorker.Result.success()

    val fetch = fetchSyncFile(httpClient, credentials, BackgroundSyncCredentialStore.getFileETag(context))
    val (body, eTag) = when (fetch) {
        SyncFileFetch.Unchanged -> return ListenableWorker.Result.success()
        is SyncFileFetch.Skip -> {
            Log.w(TAG, "HTTP ${fetch.httpCode} for sync file")
            return ListenableWorker.Result.success()
        }
        is SyncFileFetch.Retry -> {
            Log.w(TAG, "Sync file download failed: ${fetch.reason}")
            return ListenableWorker.Result.retry()
        }
        is SyncFileFetch.TooLarge -> {
            Log.w(TAG, "Sync file larger than $MAX_SYNC_FILE_BYTES bytes, skipping")
            // Keep the baseline; the ETag stops re-downloading it every period
            BackgroundSyncCredentialStore.setFileETag(context, fetch.eTag)
            return ListenableWorker.Result.success()
        }
        is SyncFileFetch.Body -> fetch.text to fetch.eTag
    }

    val decryptor = buildPayloadDecryptor(context, TAG)
    val result = SyncFileReminderReader.read(body, decryptor, credentials.isEncryptionExpected)
    if (result is SyncFileReadResult.Unreadable) {
        // Store the ETag so an unchanged file is not re-downloaded every
        // period; a password change clears it. Keep the baseline.
        Log.w(TAG, "Sync file not usable for reminders: ${result.reason}")
        BackgroundSyncCredentialStore.setFileETag(context, eTag)
        return ListenableWorker.Result.success()
    }
    val previous = parseReminderSlots(BackgroundSyncCredentialStore.getFileReminderSlotsRaw(context))
    val plan = planReminderSlots(previous, result as SyncFileReadResult.Reminders, System.currentTimeMillis())
    for (reminderId in plan.reminderIdsToCancel) {
        cancelReminderById(context, reminderId)
    }
    for (taskId in plan.taskIdsToCancel) {
        cancelRemindersForTask(context, taskId)
    }
    for (reminder in plan.toSchedule) {
        scheduleReminderFromSync(context, reminder, settings.useAlarmStyle)
    }
    BackgroundSyncCredentialStore.setFileReadResult(context, eTag, JSONObject(plan.slots).toString())
    Log.d(TAG, "Cancelled ${plan.reminderIdsToCancel.size} reminder(s), ${plan.taskIdsToCancel.size} task(s), scheduled ${plan.toSchedule.size} reminder(s)")
    return ListenableWorker.Result.success()
}

internal sealed interface SyncFileFetch {
    data object Unchanged : SyncFileFetch
    data class Retry(val reason: String) : SyncFileFetch
    /** Won't heal by retrying soon (no file yet, auth); the next period re-checks. */
    data class Skip(val httpCode: Int) : SyncFileFetch
    data class TooLarge(val eTag: String?) : SyncFileFetch
    data class Body(val text: String, val eTag: String?) : SyncFileFetch
}

/**
 * Conditional GET of the sync file. Logs nothing (JVM-testable); results
 * carry no URL or Authorization header.
 */
internal fun fetchSyncFile(
    client: OkHttpClient,
    credentials: BackgroundSyncCredentialStore.FileSyncCredentials,
    previousETag: String?,
): SyncFileFetch {
    val request = Request.Builder()
        .url(credentials.fileUrl)
        .header("Authorization", credentials.authorization)
        .apply { previousETag?.let { header("If-None-Match", it) } }
        .get()
        .build()
    return try {
        client.newCall(request).execute().use { resp ->
            when {
                resp.code == 304 -> SyncFileFetch.Unchanged
                resp.code >= 500 -> SyncFileFetch.Retry("HTTP ${resp.code}")
                !resp.isSuccessful -> SyncFileFetch.Skip(resp.code)
                else -> readBody(resp.body?.source(), resp.header("ETag"))
            }
        }
    } catch (e: IOException) {
        // class name only: some messages contain the host
        SyncFileFetch.Retry(e.javaClass.simpleName)
    }
}

private fun readBody(source: BufferedSource?, eTag: String?): SyncFileFetch {
    source ?: return SyncFileFetch.Retry("no body")
    // request() buffers at most cap + 1 bytes, also for chunked responses
    if (source.request(MAX_SYNC_FILE_BYTES + 1)) return SyncFileFetch.TooLarge(eTag)
    return SyncFileFetch.Body(source.buffer.readUtf8(), eTag)
}

private fun cancelReminderById(context: Context, reminderId: String) {
    try {
        ReminderNotificationHelper.cancelReminder(
            context, SuperSyncBackgroundProvider.generateNotificationId(reminderId)
        )
    } catch (e: Exception) {
        Log.w(TAG, "Failed to cancel a reminder", e)
    }
}
