package com.superproductivity.superproductivity.service

import android.content.Context
import android.content.Intent
import androidx.localbroadcastmanager.content.LocalBroadcastManager

object ForegroundServiceFailure {
    const val ACTION = "com.superproductivity.ACTION_FOREGROUND_SERVICE_FAILED"
    const val EXTRA_SERVICE = "service"
    const val EXTRA_REASON = "reason"

    const val SERVICE_TRACKING = "tracking"
    const val SERVICE_FOCUS_MODE = "focusMode"

    const val REASON_START_NOT_ALLOWED = "startNotAllowed"
    const val REASON_PROMOTION_FAILED = "promotionFailed"

    fun send(context: Context, service: String, reason: String) {
        val intent = Intent(ACTION).apply {
            putExtra(EXTRA_SERVICE, service)
            putExtra(EXTRA_REASON, reason)
        }
        LocalBroadcastManager.getInstance(context).sendBroadcast(intent)
    }
}
