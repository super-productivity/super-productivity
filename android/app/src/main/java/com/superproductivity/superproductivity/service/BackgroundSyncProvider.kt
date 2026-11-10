package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log

private const val TAG = "ReminderSyncHelper"
private const val DUE_DAY_SUFFIX = "_dueday"
// Must match the frontend deadline effect (mobile-notification.effects.ts) so both
// paths replace one alarm instead of scheduling two.
private const val DEADLINE_SUFFIX = "_deadline"

/**
 * A reminder detected from sync operations that should be scheduled as an AlarmManager alarm.
 */
data class ReminderToSchedule(
    val taskId: String,
    val title: String,
    val remindAt: Long,
    val isDeadline: Boolean
)

/** Reminder id as the app keys alarms (mobile-notification.effects.ts). */
internal fun reminderIdOf(reminder: ReminderToSchedule): String =
    if (reminder.isDeadline) deadlineReminderIdOf(reminder.taskId) else reminder.taskId

internal fun dueDayReminderIdOf(taskId: String): String = taskId + DUE_DAY_SUFFIX

internal fun deadlineReminderIdOf(taskId: String): String = taskId + DEADLINE_SUFFIX

/** Reminder id of a task's alarm of [reminderType] (TASK, DEADLINE or DUE_DATE). */
internal fun reminderIdOfType(taskId: String, reminderType: String): String = when (reminderType) {
    "DEADLINE" -> deadlineReminderIdOf(taskId)
    "DUE_DATE" -> dueDayReminderIdOf(taskId)
    else -> taskId
}

internal fun taskIdOfReminderId(reminderId: String): String =
    reminderId.removeSuffix(DEADLINE_SUFFIX).removeSuffix(DUE_DAY_SUFFIX)

/**
 * Cancel all reminder variants (standard, due-day, deadline) for a task.
 * Each cancellation is independent — one failure won't block the other.
 */
fun cancelRemindersForTask(context: Context, taskId: String) {
    try {
        val notificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId)
        ReminderNotificationHelper.cancelReminder(context, notificationId)
        Log.d(TAG, "Cancelled standard reminder for $taskId (id=$notificationId)")
    } catch (e: Exception) {
        Log.w(TAG, "Failed to cancel standard reminder for $taskId", e)
    }
    try {
        val dueDayNotificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId + DUE_DAY_SUFFIX)
        ReminderNotificationHelper.cancelReminder(context, dueDayNotificationId)
        Log.d(TAG, "Cancelled dueday reminder for $taskId (id=$dueDayNotificationId)")
    } catch (e: Exception) {
        Log.w(TAG, "Failed to cancel dueday reminder for $taskId", e)
    }
    try {
        val deadlineNotificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId + DEADLINE_SUFFIX)
        ReminderNotificationHelper.cancelReminder(context, deadlineNotificationId)
        Log.d(TAG, "Cancelled deadline reminder for $taskId (id=$deadlineNotificationId)")
    } catch (e: Exception) {
        Log.w(TAG, "Failed to cancel deadline reminder for $taskId", e)
    }
}

/** Cancel the single alarm keyed by [reminderId]. No-op on failure — logs and continues. */
internal fun cancelReminderById(context: Context, reminderId: String) {
    try {
        ReminderNotificationHelper.cancelReminder(
            context, SuperSyncBackgroundProvider.generateNotificationId(reminderId)
        )
    } catch (e: Exception) {
        Log.w(TAG, "Failed to cancel a reminder", e)
    }
}

/**
 * Schedule an AlarmManager alarm from a sync-detected reminder.
 * [useAlarmStyle] mirrors the user's setting; like the app
 * (capacitor-reminder.service.ts), alarm-style reminders are also ongoing.
 * No-op on failure — logs and continues.
 */
fun scheduleReminderFromSync(context: Context, reminder: ReminderToSchedule, useAlarmStyle: Boolean) {
    try {
        val reminderId = reminderIdOf(reminder)
        val notificationId = SuperSyncBackgroundProvider.generateNotificationId(reminderId)
        val reminderType = if (reminder.isDeadline) "DEADLINE" else "TASK"
        ReminderNotificationHelper.scheduleReminder(
            context, notificationId, reminderId, reminder.taskId, reminder.title,
            reminderType, reminder.remindAt, useAlarmStyle = useAlarmStyle, isOngoing = useAlarmStyle
        )
    } catch (e: Exception) {
        Log.w(TAG, "Failed to schedule reminder for task=${reminder.taskId}", e)
    }
}

/**
 * Result from a background sync provider's reminder change detection.
 *
 * @param taskIdsToCancel Task IDs whose alarms ALL go (deleted, done, archived)
 * @param remindersToSchedule List of reminders to schedule as AlarmManager alarms
 * @param latestSeq The latest server sequence number processed
 * @param hasMore Whether more operations are available (pagination)
 * @param unreadableTaskIds Task IDs touched by encrypted ops whose payload could
 *   not be decrypted (e.g. no cached key for a new desktop session), so their
 *   reminder changes are unknown
 * @param reminderIdsToCancel Single alarms to cancel (their reminder ids), for
 *   ops that clear one reminder kind and leave the task's other alarms (#10618)
 */
data class ReminderChangeResult(
    val taskIdsToCancel: Set<String>,
    val remindersToSchedule: List<ReminderToSchedule>,
    val latestSeq: Long,
    val hasMore: Boolean,
    val unreadableTaskIds: Set<String> = emptySet(),
    val reminderIdsToCancel: Set<String> = emptySet(),
) {
    /**
     * Fire-time stale check for one alarm: was it cancelled (deleted/done, or
     * its own kind dismissed/unscheduled) or rescheduled to a different time by these ops?
     *
     * A reminder these ops (re)schedule for the alarm's own slot decides first:
     * an op may cancel a task's alarms and set one slot again (an LWW snapshot
     * that sets remindAt and clears the absent deadlineRemindAt), and the alarm
     * matching that slot's time is the current schedule, not a stale one.
     * Match on the kind: a task can have both a standard and a deadline
     * reminder with different times — don't let one suppress the other.
     * DUE_DATE alarms skip that step: sync never carries a due-day reminder.
     *
     * @param triggerAtMs the alarm's scheduled trigger time, 0 when unknown
     */
    fun isAlarmStale(taskId: String, triggerAtMs: Long, reminderType: String): Boolean {
        if (reminderType != "DUE_DATE") {
            val isDeadline = reminderType == "DEADLINE"
            val current = remindersToSchedule.firstOrNull {
                it.taskId == taskId && it.isDeadline == isDeadline
            }
            if (current != null) return triggerAtMs > 0L && current.remindAt != triggerAtMs
        }
        return taskId in taskIdsToCancel || reminderIdOfType(taskId, reminderType) in reminderIdsToCancel
    }
}

/**
 * Interface for background sync providers that can detect reminder-relevant changes.
 *
 * Currently implemented for SuperSync (lightweight operation-based API).
 * WebDAV/Nextcloud have no op API and read the whole sync file instead, so they
 * diff reminder state rather than ops ([runFileSyncReminderCheck]).
 */
interface BackgroundSyncProvider {
    /**
     * Fetch task IDs that should have their reminders cancelled since lastSeq.
     *
     * @return ReminderChangeResult on success, null on error (caller should retry later)
     */
    suspend fun fetchReminderChanges(
        baseUrl: String,
        accessToken: String,
        lastSeq: Long,
        limit: Int = 100
    ): ReminderChangeResult?
}
