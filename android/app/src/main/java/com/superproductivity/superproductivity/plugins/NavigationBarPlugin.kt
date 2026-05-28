package com.superproductivity.superproductivity.plugins

import android.graphics.Color
import android.os.Build
import android.view.WindowInsetsController
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NavigationBar")
class NavigationBarPlugin : Plugin() {

    @PluginMethod
    fun setColor(call: PluginCall) {
        val color = call.getString("color") ?: run {
            call.reject("color is required")
            return
        }
        val style = call.getString("style") ?: run {
            call.reject("style is required")
            return
        }

        try {
            val parsedColor = Color.parseColor(color)
            val isLight = style == "LIGHT"
            activity.runOnUiThread {
                activity.window.navigationBarColor = parsedColor
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val controller = activity.window.insetsController
                    if (isLight) {
                        controller?.setSystemBarsAppearance(
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                        )
                    } else {
                        controller?.setSystemBarsAppearance(
                            0,
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                        )
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    @Suppress("DEPRECATION")
                    val flags = activity.window.decorView.systemUiVisibility
                    @Suppress("DEPRECATION")
                    activity.window.decorView.systemUiVisibility = if (isLight) {
                        flags or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                    } else {
                        flags and android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
                    }
                }
                call.resolve()
            }
        } catch (e: Exception) {
            call.reject("Failed to set navigation bar color: ${e.message}")
        }
    }

    /**
     * Paint the WebView's backing surface so the adjustResize keyboard
     * animation never reveals the default white surface between a layout pass
     * and the next page repaint. Kept in sync with the app theme from JS
     * because the activity is not recreated on a live light/dark switch
     * (uiMode is in configChanges), so the resource-qualifier default set at
     * WebView init would otherwise go stale.
     */
    @PluginMethod
    fun setWebViewBackgroundColor(call: PluginCall) {
        val color = call.getString("color") ?: run {
            call.reject("color is required")
            return
        }
        try {
            val parsedColor = Color.parseColor(color)
            activity.runOnUiThread {
                bridge?.webView?.setBackgroundColor(parsedColor)
                call.resolve()
            }
        } catch (e: Exception) {
            call.reject("Failed to set web view background color: ${e.message}")
        }
    }
}
