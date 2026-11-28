package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.service.ReminderNotificationHelper
import com.superproductivity.superproductivity.service.SyncReminderScheduler

/**
 * Re-registers all saved alarms after device reboot or app update.
 * Android clears all AlarmManager alarms on both events, so this receiver
 * reads persisted alarm data and re-schedules them. Without the app-update
 * path, reminders would silently stop firing after a Play Store auto-update
 * until the user next opens the app.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        Log.d(TAG, "Received $action, re-registering alarms")

        val count = ReminderNotificationHelper.rescheduleAllFromStore(context)
        Log.d(TAG, "Re-registered $count alarms")

        // Re-schedule the background sync worker if credentials are configured.
        // Off the main thread: the first credential read opens the encrypted
        // store, and the Keystore can stall past the broadcast timeout right after
        // boot, which Play vitals reported as BOOT_COMPLETED / MY_PACKAGE_REPLACED
        // ANRs. No goAsync(): it would not extend the ANR timeout, so a
        // stalled Keystore would still ANR. Without it the process may be
        // killed before this finishes, which loses nothing: WorkManager
        // restores persisted periodic work after reboot itself, and
        // CapacitorMainActivity re-runs this check on the next app start.
        val appContext = context.applicationContext
        Thread({
            try {
                if (BackgroundSyncCredentialStore.hasAnyCredentials(appContext)) {
                    SyncReminderScheduler.ensureScheduled(appContext)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Background sync scheduling check failed", e)
            }
        }, "boot-sync-schedule-check").start()
    }
}
