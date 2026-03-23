package com.superproductivity.superproductivity.service

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Helper to schedule/cancel the SyncReminderWorker via WorkManager.
 * Called from BootReceiver, CapacitorMainActivity, and JavaScriptInterface.
 */
object SyncReminderScheduler {
    private const val TAG = "SyncReminderScheduler"
    private const val WORK_NAME = "super_sync_reminder_check"

    /**
     * Ensures the periodic sync worker is scheduled. Idempotent — uses KEEP policy
     * so calling multiple times does not restart the existing schedule.
     */
    fun ensureScheduled(context: Context) {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<SyncReminderWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
                .setInitialDelay(1, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(context.applicationContext)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    workRequest
                )

            Log.d(TAG, "Sync reminder worker scheduled")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule sync reminder worker", e)
        }
    }

    /**
     * Cancels the periodic sync worker. Called when credentials are cleared.
     */
    fun cancel(context: Context) {
        try {
            WorkManager.getInstance(context.applicationContext)
                .cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Sync reminder worker cancelled")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cancel sync reminder worker", e)
        }
    }
}
