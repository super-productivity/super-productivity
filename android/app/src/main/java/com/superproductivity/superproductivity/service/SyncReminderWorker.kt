package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * WorkManager CoroutineWorker that periodically fetches operations from the sync
 * server and cancels stale Android reminders (AlarmManager alarms + active notifications).
 *
 * Runs every 15 minutes when network is available. Does NOT apply full state changes —
 * only cancels reminders for tasks that are done, deleted, archived, or had their
 * reminders dismissed/cleared on another device.
 */
class SyncReminderWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "SyncReminderWorker"
    }

    override suspend fun doWork(): Result {
        val credentials = BackgroundSyncCredentialStore.get(applicationContext)
        if (credentials == null) {
            Log.d(TAG, "No sync credentials configured, skipping")
            return Result.success()
        }

        val provider = SuperSyncBackgroundProvider()
        var lastSeq = BackgroundSyncCredentialStore.getLastServerSeq(
            applicationContext, credentials.baseUrl
        )

        Log.d(TAG, "Starting sync check from seq=$lastSeq")

        var totalCancelled = 0
        var hasMore = true
        var iterations = 0
        val maxIterations = 100

        while (hasMore && iterations < maxIterations) {
            iterations++
            val result = provider.fetchReminderChanges(
                credentials.baseUrl,
                credentials.accessToken,
                lastSeq
            )

            if (result == null) {
                Log.w(TAG, "Fetch failed, will retry later")
                return Result.retry()
            }

            // Cancel reminders for each affected task
            for (taskId in result.taskIdsToCancel) {
                cancelReminderForTask(taskId)
                totalCancelled++
            }

            // Update sequence cursor
            if (result.latestSeq > lastSeq) {
                lastSeq = result.latestSeq
                BackgroundSyncCredentialStore.setLastServerSeq(
                    applicationContext, credentials.baseUrl, lastSeq
                )
            }

            hasMore = result.hasMore
        }

        if (iterations >= maxIterations) {
            Log.w(TAG, "Hit max pagination iterations ($maxIterations), stopping. seq=$lastSeq")
        }

        if (totalCancelled > 0) {
            Log.d(TAG, "Cancelled $totalCancelled reminder(s), seq now=$lastSeq")
        } else {
            Log.d(TAG, "No reminders to cancel, seq now=$lastSeq")
        }

        return Result.success()
    }

    private fun cancelReminderForTask(taskId: String) {
        try {
            // Cancel the standard reminder notification
            val notificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId)
            ReminderNotificationHelper.cancelReminder(applicationContext, notificationId)

            // Cancel the due-date variant notification
            val dueDayNotificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId + "_dueday")
            ReminderNotificationHelper.cancelReminder(applicationContext, dueDayNotificationId)

            Log.d(TAG, "Cancelled reminder for task=$taskId (ids=$notificationId, $dueDayNotificationId)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cancel reminder for task=$taskId", e)
        }
    }
}
