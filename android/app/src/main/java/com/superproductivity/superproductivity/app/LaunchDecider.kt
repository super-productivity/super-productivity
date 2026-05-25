package com.superproductivity.superproductivity.app

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import androidx.preference.PreferenceManager
import com.superproductivity.superproductivity.BuildConfig
import java.io.File

/**
 * Determines which launch mode to use. (Online-old or Offline-new)
 */
class LaunchDecider(private val context: Context) {

    companion object {
        // Enum values represented as integers
        private const val LAUNCH_MODE_KEY = "launch_mode"
        private const val MODE_DEFAULT = 0 // Need to determine
        private const val MODE_ONLINE = 1  // Use FullscreenActivity (old activity)
        private const val MODE_OFFLINE = 2 // Use CapacitorMainActivity (new activity)
    }

    private val sharedPrefs: SharedPreferences =
        PreferenceManager.getDefaultSharedPreferences(context)

    /**
     * Determines which launch mode to use.
     * If the mode is MODE_DEFAULT, it will perform checks to decide between MODE_ONLINE and MODE_OFFLINE.
     * If LAUNCH_MODE is set to 1 or 2, it will force the corresponding mode.
     * The result is saved in SharedPreferences for future launches.
     */
    fun getLaunchMode(): Int {
        val launchMode = BuildConfig.LAUNCH_MODE.toIntOrNull() ?: 0
        return when (launchMode) {
            1 -> MODE_ONLINE
            2 -> MODE_OFFLINE
            else -> {
                val currentMode = sharedPrefs.getInt(LAUNCH_MODE_KEY, MODE_DEFAULT)
                if (currentMode != MODE_DEFAULT) {
                    // If mode is already determined, return it
                    currentMode
                } else {
                    // Mode is MODE_DEFAULT, need to determine
                    val newMode = determineLaunchMode()
                    // Save the new mode for future launches
                    sharedPrefs.edit().putInt(LAUNCH_MODE_KEY, newMode).apply()
                    newMode
                }
            }
        }
    }

    /**
     * Determines whether to use MODE_ONLINE or MODE_OFFLINE.
     * Logic:
     * - If firstInstallTime == lastUpdateTime, it's a new installation -> MODE_OFFLINE
     * - If firstInstallTime < lastUpdateTime, it's an upgrade:
     *   - If databases/SupKeyValStore file exists, user has data -> MODE_ONLINE
     *   - If not, user might not have data -> MODE_OFFLINE
     */
    private fun determineLaunchMode(): Int {
        val packageManager = context.packageManager
        val packageName = context.packageName
        try {
            val packageInfo = packageManager.getPackageInfo(packageName, 0)
            val firstInstallTime = packageInfo.firstInstallTime
            val lastUpdateTime = packageInfo.lastUpdateTime

            return if (firstInstallTime == lastUpdateTime) {
                // New installation
                MODE_OFFLINE
            } else {
                // Upgrade installation
                if (hasLegacyData()) {
                    // User has existing data, use online mode
                    MODE_ONLINE
                } else {
                    // No existing data, use offline mode
                    MODE_OFFLINE
                }
            }
        } catch (e: PackageManager.NameNotFoundException) {
            e.printStackTrace()
            // In case of error, default to online mode to be safe
            return MODE_ONLINE
        }
    }

    /**
     * Checks if the legacy data file exists.
     * Returns true if databases/SupKeyValStore file exists.
     */
    private fun hasLegacyData(): Boolean {
        val dataDir = context.filesDir.parentFile
        val dbFile = File(dataDir, "databases/SupKeyValStore")
        return dbFile.exists()
    }

    /**
     * Helper method to check if we should switch to the new activity.
     * Returns true if MODE_OFFLINE (value 2), indicating we should switch to CapacitorMainActivity.
     */
    fun shouldSwitchToNewActivity(): Boolean {
        return getLaunchMode() == MODE_OFFLINE
    }
}
