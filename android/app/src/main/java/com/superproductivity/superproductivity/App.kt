package com.superproductivity.superproductivity

import android.app.Application
import android.os.Looper
import android.os.MessageQueue
import android.util.Log
import android.webkit.WebSettings
import com.superproductivity.superproductivity.app.AppLifecycleObserver
import com.superproductivity.superproductivity.app.KeyValStore

class App : Application() {

    val keyValStore: KeyValStore by lazy {
        KeyValStore(this)
    }

    override fun onCreate() {
        super.onCreate()

        // Initialize AppLifecycleObserver at app startup
        AppLifecycleObserver.getInstance()

        // Prewarm WebView by loading native libraries during idle time
        prewarmWebView()
    }

    /**
     * Prewarms the WebView's Chromium engine by triggering native library loading
     * during main thread idle time. This reduces the 200-300ms freeze that occurs
     * on first WebView creation.
     *
     * Uses WebSettings.getDefaultUserAgent() as recommended by the Chromium team -
     * it loads WebView libraries without side effects.
     */
    private fun prewarmWebView() {
        try {
            Looper.getMainLooper().queue.addIdleHandler(object : MessageQueue.IdleHandler {
                override fun queueIdle(): Boolean {
                    try {
                        val startTime = System.currentTimeMillis()
                        WebSettings.getDefaultUserAgent(this@App)
                        val duration = System.currentTimeMillis() - startTime
                        Log.d("SP-WebView", "WebView prewarmed in ${duration}ms")
                    } catch (e: Exception) {
                        Log.w("SP-WebView", "WebView prewarm failed: ${e.message}")
                    }
                    return false // Remove handler after execution
                }
            })
        } catch (e: Exception) {
            Log.w("SP-WebView", "Failed to schedule WebView prewarm: ${e.message}")
        }
    }
}
