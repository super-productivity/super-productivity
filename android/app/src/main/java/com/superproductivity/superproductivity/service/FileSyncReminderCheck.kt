package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import androidx.work.ListenableWorker
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val TAG = "FileSyncReminderCheck"
private const val DEADLINE_SUFFIX = "_deadline"

private val httpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .callTimeout(120, TimeUnit.SECONDS)
    .build()

/**
 * What one file read changes: alarms to cancel (their reminder ids), alarms to
 * (re)schedule, and the slots to remember for the next diff.
 */
internal data class ReminderSlotPlan(
    val reminderIdsToCancel: Set<String>,
    val toSchedule: List<ReminderToSchedule>,
    val slots: Map<String, Long>,
)

/** Reminder id as the app keys alarms (mobile-notification.effects.ts). */
internal fun reminderIdOf(reminder: ReminderToSchedule): String =
    if (reminder.isDeadline) reminder.taskId + DEADLINE_SUFFIX else reminder.taskId

/**
 * Diffs the reminder slots of the file against those of the last processed
 * read. Without a previous read nothing is cancelled: alarms the app set for
 * reminders this worker never saw are not its to judge.
 */
internal fun planReminderSlots(
    previous: Map<String, Long>?,
    current: List<ReminderToSchedule>,
    now: Long,
): ReminderSlotPlan {
    val slots = current.associateBy({ reminderIdOf(it) }, { it.remindAt })
    if (previous == null) return ReminderSlotPlan(emptySet(), current.filter { it.remindAt > now }, slots)

    val changed = current.filter { previous[reminderIdOf(it)] != it.remindAt }
    // Past slots are kept for the diff but not scheduled: they already fired.
    // One moved into the past still has its old alarm pending, so cancel that.
    val movedIntoPast = changed.filter { it.remindAt <= now && reminderIdOf(it) in previous }
    val toCancel = (previous.keys - slots.keys) + movedIntoPast.map { reminderIdOf(it) }
    return ReminderSlotPlan(toCancel, changed.filter { it.remindAt > now }, slots)
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

    val previousETag = BackgroundSyncCredentialStore.getFileETag(context)
    val request = Request.Builder()
        .url(credentials.fileUrl)
        .header("Authorization", credentials.authorization)
        .apply { previousETag?.let { header("If-None-Match", it) } }
        .get()
        .build()

    val (body, eTag) = try {
        httpClient.newCall(request).execute().use { resp ->
            if (resp.code == 304) {
                Log.d(TAG, "Sync file unchanged")
                return ListenableWorker.Result.success()
            }
            if (!resp.isSuccessful) {
                Log.w(TAG, "HTTP ${resp.code} for sync file")
                // 4xx (no file yet, auth) won't heal by retrying soon; the next period re-checks
                return if (resp.code >= 500) ListenableWorker.Result.retry() else ListenableWorker.Result.success()
            }
            val text = resp.body?.string() ?: return ListenableWorker.Result.retry()
            text to resp.header("ETag")
        }
    } catch (e: IOException) {
        Log.w(TAG, "Failed to download sync file", e)
        return ListenableWorker.Result.retry()
    }

    val decryptor = buildPayloadDecryptor(context, TAG)
    val result = SyncFileReminderReader.read(body, decryptor, credentials.isEncryptionExpected)
    if (result is SyncFileReadResult.Unreadable) {
        // Keep ETag and baseline: a password fix or format change re-reads it
        Log.w(TAG, "Sync file not usable for reminders: ${result.reason}")
        return ListenableWorker.Result.success()
    }
    val reminders = (result as SyncFileReadResult.Reminders).reminders

    val previous = parseReminderSlots(BackgroundSyncCredentialStore.getFileReminderSlotsRaw(context))
    val plan = planReminderSlots(previous, reminders, System.currentTimeMillis())
    for (reminderId in plan.reminderIdsToCancel) {
        cancelReminderById(context, reminderId)
    }
    for (reminder in plan.toSchedule) {
        scheduleReminderFromSync(context, reminder, settings.useAlarmStyle)
    }
    BackgroundSyncCredentialStore.setFileReadResult(context, eTag, JSONObject(plan.slots).toString())
    Log.d(TAG, "Cancelled ${plan.reminderIdsToCancel.size}, scheduled ${plan.toSchedule.size} reminder(s)")
    return ListenableWorker.Result.success()
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
