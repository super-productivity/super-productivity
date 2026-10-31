package com.superproductivity.superproductivity.share

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/**
 * Retries one share upload ([ShareUploader]) when the attempt made right
 * after the share did not get through: offline, a killed process, a server
 * error. Not expedited, which would need a foreground service on API < 31;
 * a share that waits is still taken over by the app when it next opens.
 */
class ShareUploadWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {

    override fun doWork(): Result {
        val id = inputData.getString(KEY_ID) ?: return Result.success()
        val outcome = try {
            ShareUploader.attempt(applicationContext, id)
        } catch (e: Exception) {
            Log.e(TAG, "Share $id upload attempt failed", e)
            ShareUploader.Outcome.RETRY
        }
        return when (outcome) {
            ShareUploader.Outcome.DONE, ShareUploader.Outcome.RELEASED -> Result.success()
            ShareUploader.Outcome.RETRY ->
                if (runAttemptCount + 1 >= MAX_ATTEMPTS) {
                    Log.d(TAG, "Share $id upload gave up after $MAX_ATTEMPTS attempts")
                    ShareUploader.release(applicationContext, id)
                    Result.success()
                } else {
                    Result.retry()
                }
        }
    }

    companion object {
        private const val TAG = "SP_SHARE"
        private const val KEY_ID = "captureId"
        private const val MAX_ATTEMPTS = 12

        private fun workName(id: String) = "share-upload-$id"

        fun enqueue(context: Context, id: String) {
            try {
                val request = OneTimeWorkRequestBuilder<ShareUploadWorker>()
                    .setInputData(workDataOf(KEY_ID to id))
                    .setConstraints(
                        Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED)
                            .build(),
                    )
                    // Leaves the first attempt (from the share itself) time to finish.
                    .setInitialDelay(30, TimeUnit.SECONDS)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
                WorkManager.getInstance(context.applicationContext)
                    .enqueueUniqueWork(workName(id), ExistingWorkPolicy.KEEP, request)
            } catch (e: Exception) {
                // The entry stays in the inbox; the app takes it over on open.
                Log.e(TAG, "Failed to schedule share upload $id", e)
            }
        }

        fun cancel(context: Context, id: String) {
            try {
                WorkManager.getInstance(context.applicationContext)
                    .cancelUniqueWork(workName(id))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to cancel share upload $id", e)
            }
        }
    }
}
