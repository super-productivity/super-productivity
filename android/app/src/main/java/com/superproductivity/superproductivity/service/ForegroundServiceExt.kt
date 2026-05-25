package com.superproductivity.superproductivity.service

import android.app.Notification
import android.app.Service
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.ServiceCompat

// Why: on Android 14+ the FGS type must match the manifest's `specialUse`
// declaration. Passing it explicitly via ServiceCompat is Google's documented
// best practice and removes OEM-dependent fallback ambiguity. Both
// FocusModeForegroundService and TrackingForegroundService declare
// `specialUse` and share this helper.
fun Service.startForegroundSpecialUse(id: Int, notification: Notification): Boolean {
    return try {
        ServiceCompat.startForeground(
            this,
            id,
            notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            else 0,
        )
        true
    } catch (e: IllegalArgumentException) {
        Log.e(javaClass.simpleName, "Unable to start foreground service: invalid notification", e)
        false
    } catch (e: IllegalStateException) {
        Log.e(javaClass.simpleName, "Unable to start foreground service: start not allowed", e)
        false
    } catch (e: SecurityException) {
        Log.e(javaClass.simpleName, "Unable to start foreground service: missing permission", e)
        false
    }
}
