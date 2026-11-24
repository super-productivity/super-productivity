package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.superproductivity.superproductivity.service.TimeEstimateAlarm
import com.superproductivity.superproductivity.service.TrackingForegroundService

/** Shows the "time estimate exceeded" notification armed by [TimeEstimateAlarm] (#11896). */
class TimeEstimateAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TimeEstimateAlarm.ACTION_TIME_ESTIMATE_EXCEEDED) return
        val estimate = TimeEstimateAlarm.fromIntent(intent) ?: return
        val toShow = TrackingForegroundService.onTimeEstimateAlarm(context, estimate) ?: return
        TimeEstimateAlarm.showNotification(context, toShow)
    }
}
