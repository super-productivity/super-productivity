package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.service.ReminderNotificationHelper
import com.superproductivity.superproductivity.service.SuperSyncBackgroundProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Receives alarm broadcasts and shows reminder notifications.
 * Before showing, does a quick server check to suppress stale notifications
 * (task deleted/done/dismissed on another device). Fail-open on any error.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "ReminderAlarmReceiver"
        const val ACTION_SHOW_REMINDER = "com.superproductivity.ACTION_SHOW_REMINDER"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_REMINDER_ID = "reminder_id"
        const val EXTRA_RELATED_ID = "related_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_REMINDER_TYPE = "reminder_type"
        const val EXTRA_USE_ALARM_STYLE = "use_alarm_style"
        const val EXTRA_IS_ONGOING = "is_ongoing"
        const val EXTRA_TRIGGER_AT_MS = "trigger_at_ms"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SHOW_REMINDER) return

        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val relatedId = intent.getStringExtra(EXTRA_RELATED_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Reminder"
        val reminderType = intent.getStringExtra(EXTRA_REMINDER_TYPE) ?: "TASK"
        val useAlarmStyle = intent.getBooleanExtra(EXTRA_USE_ALARM_STYLE, false)
        val isOngoing = intent.getBooleanExtra(EXTRA_IS_ONGOING, false)
        val triggerAtMs = intent.getLongExtra(EXTRA_TRIGGER_AT_MS, 0L)

        Log.d(TAG, "Alarm triggered: id=$notificationId, title=$title, triggerAt=$triggerAtMs")

        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                val isStale = isTaskStale(context, relatedId, triggerAtMs, reminderType)
                if (isStale) {
                    Log.d(TAG, "Suppressed stale notification: id=$notificationId, task=$relatedId")
                    ReminderNotificationHelper.cancelReminder(context, notificationId)
                } else {
                    ReminderNotificationHelper.showNotification(
                        context, notificationId, reminderId, relatedId,
                        title, reminderType, useAlarmStyle, isOngoing
                    )
                }
            } catch (e: Exception) {
                // Fail-open: show notification on any error
                Log.w(TAG, "Check failed, showing notification anyway: id=$notificationId", e)
                ReminderNotificationHelper.showNotification(
                    context, notificationId, reminderId, relatedId,
                    title, reminderType, useAlarmStyle, isOngoing
                )
            } finally {
                pendingResult.finish()
            }
        }
    }

    /**
     * Quick server check: is this task stale (deleted/done/dismissed/rescheduled)?
     * Uses fetchQuick with tight OkHttp timeouts (5s callTimeout) that actually
     * interrupt blocking I/O. Returns false (fail-open) on any error or timeout.
     *
     * Only checks the triggering task — all other reminder management is left
     * to the SyncReminderWorker which owns the seq cursor and handles pagination.
     *
     * @param triggerAtMs The alarm's scheduled trigger time. Used to distinguish
     *   "this is the current schedule" from "this was rescheduled to a different time".
     */
    private suspend fun isTaskStale(context: Context, taskId: String, triggerAtMs: Long, reminderType: String): Boolean {
        val credentials = BackgroundSyncCredentialStore.get(context) ?: return false
        val lastSeq = BackgroundSyncCredentialStore.getLastServerSeq(
            context, credentials.baseUrl
        )

        val result = SuperSyncBackgroundProvider().fetchQuick(
            credentials.baseUrl, credentials.accessToken, lastSeq
        ) ?: return false  // Error -> fail-open

        // Stale if explicitly cancelled (deleted/done/dismissed/unscheduled)
        if (taskId in result.taskIdsToCancel) return true

        // Check if the task was rescheduled to a DIFFERENT time on another device.
        // If the schedule op's remindAt matches this alarm's triggerAtMs, this IS
        // the current schedule — not stale. Only suppress if times differ.
        // Match on isDueDate too: a task can have both a standard reminder and a
        // deadline reminder with different times — don't let one suppress the other.
        if (triggerAtMs > 0L) {
            val isDueDate = reminderType == "DUE_DATE"
            val rescheduled = result.remindersToSchedule.any {
                it.taskId == taskId && it.isDueDate == isDueDate && it.remindAt != triggerAtMs
            }
            if (rescheduled) {
                Log.d(TAG, "Task $taskId was rescheduled (trigger=$triggerAtMs), suppressing")
                return true
            }
        }

        return false
    }
}
