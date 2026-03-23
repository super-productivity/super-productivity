package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log

private const val TAG = "ReminderSyncHelper"
private const val DUE_DAY_SUFFIX = "_dueday"

/**
 * A reminder detected from sync operations that should be scheduled as an AlarmManager alarm.
 */
data class ReminderToSchedule(
    val taskId: String,
    val title: String,
    val remindAt: Long,
    val isDueDate: Boolean
)

/**
 * Cancel both reminder variants (standard + due-day) for a task.
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
}

/**
 * Schedule an AlarmManager alarm from a sync-detected reminder.
 * Uses conservative defaults (no alarm style, not ongoing) since user
 * preferences are not available in the background context.
 * No-op on failure — logs and continues.
 */
fun scheduleReminderFromSync(context: Context, reminder: ReminderToSchedule) {
    try {
        val reminderId = if (reminder.isDueDate) reminder.taskId + DUE_DAY_SUFFIX else reminder.taskId
        val notificationId = SuperSyncBackgroundProvider.generateNotificationId(reminderId)
        val reminderType = if (reminder.isDueDate) "DUE_DATE" else "TASK"
        ReminderNotificationHelper.scheduleReminder(
            context, notificationId, reminderId, reminder.taskId, reminder.title,
            reminderType, reminder.remindAt, useAlarmStyle = false, isOngoing = false
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
 */
data class ReminderChangeResult(
    val taskIdsToCancel: Set<String>,
    val remindersToSchedule: List<ReminderToSchedule>,
    val latestSeq: Long,
    val hasMore: Boolean
)

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
