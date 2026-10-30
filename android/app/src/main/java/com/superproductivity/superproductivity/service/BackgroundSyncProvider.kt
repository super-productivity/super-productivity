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

/**
 * Schedule an AlarmManager alarm from a sync-detected reminder.
 * [useAlarmStyle] mirrors the user's setting; like the app
 * (capacitor-reminder.service.ts), alarm-style reminders are also ongoing.
 * No-op on failure — logs and continues.
 */
fun scheduleReminderFromSync(context: Context, reminder: ReminderToSchedule, useAlarmStyle: Boolean) {
    try {
        val reminderId = if (reminder.isDeadline) reminder.taskId + DEADLINE_SUFFIX else reminder.taskId
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
 * @param taskIdsToCancel Set of task IDs whose reminders should be cancelled
 * @param remindersToSchedule List of reminders to schedule as AlarmManager alarms
 * @param latestSeq The latest server sequence number processed
 * @param hasMore Whether more operations are available (pagination)
 * @param unreadableTaskIds Task IDs touched by encrypted ops whose payload could
 *   not be decrypted (e.g. no cached key for a new desktop session), so their
 *   reminder changes are unknown
 */
data class ReminderChangeResult(
    val taskIdsToCancel: Set<String>,
    val remindersToSchedule: List<ReminderToSchedule>,
    val latestSeq: Long,
    val hasMore: Boolean,
    val unreadableTaskIds: Set<String> = emptySet(),
) {
    /**
     * Fire-time stale check for one alarm: was it cancelled (deleted/done/
     * dismissed/unscheduled) or rescheduled to a different time by these ops?
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
        return taskId in taskIdsToCancel
    }
}

/**
 * Interface for background sync providers that can detect reminder-relevant changes.
 *
 * Currently implemented for SuperSync (lightweight operation-based API).
 * Could be extended to Dropbox/WebDAV in the future, though those would require
 * downloading the full sync file which is heavier.
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
