package com.superproductivity.superproductivity

import android.app.Application
import com.superproductivity.superproductivity.app.AppLifecycleObserver
import com.superproductivity.superproductivity.app.KeyValStore

class App : Application() {

    val keyValStore: KeyValStore by lazy {
        KeyValStore(this)
    }

    /**
     * Never prewarm the WebView here, on any thread. It gains nothing —
     * `WebViewCompatibilityChecker.evaluate()` already calls `getDefaultUserAgent()` as
     * the first statement of both launch paths, and Chromium startup blocks on the
     * WebView UI thread whichever thread asks. It costs: this also runs in headless
     * processes (alarms, widget, sync worker), where the load is pure waste, makes the
     * process a kill target on every WebView provider update, and — inferred, not
     * measured — a failure there may leave the process unable to start a WebView at all,
     * which the user meets as a block screen on the next launch. → issues #7229, #7518.
     */
    override fun onCreate() {
        super.onCreate()

        // Initialize AppLifecycleObserver at app startup
        AppLifecycleObserver.getInstance()
    }
}
