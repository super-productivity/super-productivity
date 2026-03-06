package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.superproductivity.superproductivity.CapacitorMainActivity

/**
 * Re-registers reminder alarms after device reboot.
 * AlarmManager alarms are lost on reboot, so the app must be started
 * to allow MobileNotificationEffects to re-schedule them.
 */
class BootReceiver : BroadcastReceiver() {
    companion object {
        const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        Log.d(TAG, "Boot completed - launching app to re-register reminder alarms")

        val launchIntent = Intent(context, CapacitorMainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)
    }
}
