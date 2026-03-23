package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * WorkManager CoroutineWorker that periodically fetches operations from the sync
 * server, cancels stale Android reminders (AlarmManager alarms + active notifications),
 * and schedules new/updated reminders.
 *
 * Runs every 15 minutes when network is available. Does NOT apply full state changes —
 * only manages reminders for tasks that changed on another device (done, deleted,
 * archived, dismissed, or newly created/updated).
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
        var totalScheduled = 0
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
                cancelRemindersForTask(applicationContext, taskId)
                totalCancelled++
            }

            // Schedule new reminders
            for (reminder in result.remindersToSchedule) {
                scheduleReminderFromSync(applicationContext, reminder)
                totalScheduled++
            }

            // Update sequence cursor.
            // Also reset if server's latestSeq is lower (server was wiped/reset).
            if (result.latestSeq != lastSeq) {
                if (result.latestSeq < lastSeq) {
                    Log.w(TAG, "Server seq (${ result.latestSeq}) < local seq ($lastSeq), server was likely reset. Resetting cursor.")
                }
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

        if (totalCancelled > 0 || totalScheduled > 0) {
            Log.d(TAG, "Cancelled $totalCancelled, scheduled $totalScheduled reminder(s), seq now=$lastSeq")
        } else {
            Log.d(TAG, "No reminder changes, seq now=$lastSeq")
        }

        return Result.success()
    }

}
