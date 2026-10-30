package com.superproductivity.superproductivity.app

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.VisibleForTesting

/**
 * Drops the VIEW data URI the system replays when it relaunches the task after a
 * package update (#11153). The update kills the process, then the system restarts
 * the task from its base intent: a fresh activity with no saved state and,
 * judging by the report, no LAUNCHED_FROM_HISTORY flag (unconfirmed), so
 * CapacitorMainActivity's other guards miss it and a create-task URL would add
 * the same task again (synced to every device).
 *
 * The replayed intent is byte-identical to the original tap, so it is told apart
 * by "same task, and the package was updated after this URL was dispatched".
 * The relaunch reuses the task (the report shows PackageUpdateActivity with this
 * task's root), while a tap after swiping the task away opens a new one. Repeat
 * taps of the same URL still dispatch; one is dropped only when it is the first
 * fresh launch after an update, in the same task, with the identical URL.
 */
object LaunchUrlReplayGuard {
    private const val PREFS_NAME = "SuperProductivityLaunchUrl"
    private const val KEY_URI_HASH = "BASE_URI_HASH"
    private const val KEY_TASK_ID = "BASE_URI_TASK_ID"
    private const val KEY_LAUNCHED_AT = "BASE_URI_LAUNCHED_AT"

    /** A hash, so task titles from create-task URLs don't linger on disk. */
    @VisibleForTesting
    internal data class BaseUrl(val uriHash: Int, val taskId: Int, val launchedAtMs: Long)

    /**
     * Only call for a fresh activity (null savedInstanceState): its intent is the
     * task's base intent. onNewIntent deliveries don't change the base intent, so
     * they must not touch the stored URL.
     *
     * @return false if the activity's VIEW URI is a replay and must not be dispatched.
     */
    fun shouldDispatchFreshLaunch(activity: Activity): Boolean {
        val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val stored = if (prefs.contains(KEY_URI_HASH)) {
            BaseUrl(
                prefs.getInt(KEY_URI_HASH, 0),
                prefs.getInt(KEY_TASK_ID, -1),
                prefs.getLong(KEY_LAUNCHED_AT, 0L),
            )
        } else {
            null
        }
        val launch = baseUrlOf(
            activity.intent?.data?.toString(),
            activity.taskId,
            System.currentTimeMillis(),
        )
        val replay = isReplay(stored, launch, packageUpdatedAtMs(activity))
        // Store every launch, dropped replays included: the base intent still
        // carries the URL, so the next update relaunch is caught again, while later
        // same-URL taps dispatch as long as no update intervenes.
        val editor = prefs.edit()
        if (launch == null) {
            editor.remove(KEY_URI_HASH).remove(KEY_TASK_ID).remove(KEY_LAUNCHED_AT)
        } else {
            editor.putInt(KEY_URI_HASH, launch.uriHash)
                .putInt(KEY_TASK_ID, launch.taskId)
                .putLong(KEY_LAUNCHED_AT, launch.launchedAtMs)
        }
        editor.apply()
        return !replay
    }

    /** Null for a launch without a URL: it becomes the task's base intent, nothing to replay. */
    @VisibleForTesting
    internal fun baseUrlOf(uri: String?, taskId: Int, nowMs: Long): BaseUrl? =
        uri?.let { BaseUrl(it.hashCode(), taskId, nowMs) }

    @VisibleForTesting
    internal fun isReplay(stored: BaseUrl?, launch: BaseUrl?, packageUpdatedAtMs: Long): Boolean =
        stored != null && launch != null &&
            launch.uriHash == stored.uriHash &&
            launch.taskId == stored.taskId &&
            packageUpdatedAtMs > stored.launchedAtMs

    private fun packageUpdatedAtMs(context: Context): Long {
        val pm = context.packageManager
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(context.packageName, 0)
        }
        return info.lastUpdateTime
    }
}
