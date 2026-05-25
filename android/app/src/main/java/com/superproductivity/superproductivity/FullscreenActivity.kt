package com.superproductivity.superproductivity

import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.JsResult
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.anggrayudi.storage.SimpleStorageHelper
import com.superproductivity.superproductivity.app.LaunchDecider
import com.superproductivity.superproductivity.service.ForegroundServiceFailure
import com.superproductivity.superproductivity.util.printWebViewVersion
import com.superproductivity.superproductivity.webview.JavaScriptInterface
import com.superproductivity.superproductivity.webview.WebHelper
import com.superproductivity.superproductivity.webview.WebViewBlockActivity
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker
import com.superproductivity.superproductivity.webview.WebViewRequestHandler
import org.json.JSONObject


/**
 * An example full-screen activity that shows and hides the system UI (i.e.
 * status bar and navigation/system bar) with user interaction.
 */
class FullscreenActivity : AppCompatActivity() {
    private lateinit var javaScriptInterface: JavaScriptInterface
    private lateinit var webView: WebView
    private lateinit var wvContainer: FrameLayout
    private var isForegroundServiceFailureReceiverRegistered = false
    private var webViewRequestHandler = WebViewRequestHandler(this, BuildConfig.ONLINE_SERVICE_HOST)
    val storageHelper =
        SimpleStorageHelper(this) // for scoped storage permission management on Android 10+
    val appUrl =
//        if (BuildConfig.DEBUG) "https://test-app.super-productivity.com" else "https://app.super-productivity.com"
        "${BuildConfig.ONLINE_SERVICE_PROTOCOL}://${BuildConfig.ONLINE_SERVICE_HOST}"

    private val foregroundServiceFailureReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ForegroundServiceFailure.ACTION) {
                return
            }
            val service = intent.getStringExtra(ForegroundServiceFailure.EXTRA_SERVICE) ?: return
            val reason = intent.getStringExtra(ForegroundServiceFailure.EXTRA_REASON) ?: return
            callJSInterfaceFunctionIfExists(
                "next",
                "onForegroundServiceStartFailed$",
                "{service:${JSONObject.quote(service)},reason:${JSONObject.quote(reason)}}"
            )
        }
    }

    @Suppress("ReplaceCallWithBinaryOperator")
    override fun onCreate(savedInstanceState: Bundle?) {
        Log.v("TW", "FullScreenActivity: onCreate")
        super.onCreate(savedInstanceState)

        val compatibility = try {
            WebViewCompatibilityChecker.evaluate(this)
        } catch (e: Throwable) {
            showWebViewInitFailureOrThrow("WebView compatibility check failed", e)
            return
        }
        if (compatibility.isBlocked) {
            WebViewBlockActivity.present(this, compatibility)
            finish()
            return
        } else if (compatibility.status == WebViewCompatibilityChecker.Status.WARN) {
            Log.w(
                "SP-WebView",
                "WebView version ${compatibility.majorVersion ?: "unknown"} below recommended ${WebViewCompatibilityChecker.RECOMMENDED_CHROMIUM_VERSION}",
            )
        }

        // Determines which launch mode to use. (Online-old or Offline-new)
        val launchDecider = LaunchDecider(this)
        if (launchDecider.shouldSwitchToNewActivity()) {
            // Switch to CapacitorMainActivity
            val intent = intent.setComponent(ComponentName(this, CapacitorMainActivity::class.java))
            startActivity(intent)
            finish()
            return
        }

        if (!initWebView()) {
            showWebViewInitFailure(
                message = "Failed to instantiate WebView",
                compatibility = compatibility,
            )
            return
        }

        // We made it past the pre-flight version check and the WebView is alive.
        // Persist the detected version so a transient mis-read on a later launch
        // can't lock the user out, and clear any prior user override if healthy.
        WebViewCompatibilityChecker.recordSuccessfulLoad(this, compatibility.majorVersion)

        // FOR TESTING HTML INPUTS QUICKLY
////        webView = (application as App).wv
//        webView = WebHelper().instanceView(this)
////        webView = WebView(this)
//        val data = "<html><body><h1>TEST</h1><h2>aa</h2><input type = 'color'  value='#ae1234'>"
//        webView.settings.javaScriptEnabled = true
//        webView.loadData(data, "text/html; charset=utf-8", "UTF-8")
//        webView.loadDataWithBaseURL(null, data, "text/html", "UTF-8", null)


        setContentView(R.layout.activity_fullscreen)
        wvContainer = findViewById(R.id.webview_container)
        wvContainer.addView(webView)
        LocalBroadcastManager.getInstance(this).registerReceiver(
            foregroundServiceFailureReceiver,
            IntentFilter(ForegroundServiceFailure.ACTION)
        )
        isForegroundServiceFailureReceiverRegistered = true
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(appUrl)
        }


        val rootView = findViewById<View>(android.R.id.content)
        rootView.viewTreeObserver.addOnGlobalLayoutListener {
            val rect = Rect()
            rootView.getWindowVisibleDisplayFrame(rect)
            val screenHeight = rootView.rootView.height

            // rect.bottom is the position above soft keypad or device button.
            // if keypad is shown, the rect.bottom is smaller than the screen height.
            val keypadHeight = screenHeight - rect.bottom
            // 0.15 ratio is perhaps enough to determine keypad height.
            if (keypadHeight > screenHeight * 0.15) {
                // keyboard is opened
                callJSInterfaceFunctionIfExists("next", "isKeyboardShown$", "true")
            } else {
                // keyboard is closed
                callJSInterfaceFunctionIfExists("next", "isKeyboardShown$", "false")
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        // Save scoped storage permission on Android 10+
        storageHelper.onSaveInstanceState(outState)
        if (::webView.isInitialized) {
            webView.saveState(outState)
        }
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        // Restore scoped storage permission on Android 10+
        super.onRestoreInstanceState(savedInstanceState)
        storageHelper.onRestoreInstanceState(savedInstanceState)
        if (::webView.isInitialized) {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onPause() {
        super.onPause()
        Log.v("TW", "FullScreenActivity: onPause")
        callJSInterfaceFunctionIfExists("next", "onPause$")
    }

    override fun onResume() {
        super.onResume()
        Log.v("TW", "FullScreenActivity: onResume")
        callJSInterfaceFunctionIfExists("next", "onResume$")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Log.v("TW", "FullScreenActivity: onNewIntent")
        val action = intent.getStringExtra("action")
        Log.v("TW", "FullScreenActivity: action $action")
        if (action == null) {
            return
        }
    }

    @RequiresApi(Build.VERSION_CODES.N)
    private fun initWebView(): Boolean {
        try {
            webView = WebHelper().instanceView(this)
            if (BuildConfig.DEBUG) {
                Toast.makeText(this, "DEBUG: $appUrl", Toast.LENGTH_SHORT).show()
//            webView.clearCache(true)
//            webView.clearHistory()
                WebView.setWebContentsDebuggingEnabled(true); // necessary to enable chrome://inspect of webviews on physical remote Android devices, but not for AVD emulator, as the latter automatically enables debug build features
            }
            printWebViewVersion(webView)

            webView.loadUrl(appUrl)
            supportActionBar?.hide()
            javaScriptInterface = JavaScriptInterface(this, webView)
            webView.addJavascriptInterface(javaScriptInterface, WINDOW_INTERFACE_PROPERTY)
            if (BuildConfig.FLAVOR.equals("fdroid")) {
                webView.addJavascriptInterface(javaScriptInterface, WINDOW_PROPERTY_F_DROID)
                // not ready in time, that's why we create a second JS interface just to fill the prop
                // callJavaScriptFunction("window.$WINDOW_PROPERTY_F_DROID=true")
            }

            val swController = ServiceWorkerController.getInstance()
            swController.setServiceWorkerClient(@RequiresApi(Build.VERSION_CODES.N)
            object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
                    return webViewRequestHandler.interceptWebRequest(request)
                }
            })

            webView.webViewClient = object : WebViewClient() {
                @Deprecated("Deprecated in Java")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return webViewRequestHandler.handleUrlLoading(view, url)
                }

                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    return webViewRequestHandler.interceptWebRequest(request)
                }
            }

            webView.webChromeClient = object : WebChromeClient() {
                override fun onJsAlert(
                    view: WebView,
                    url: String,
                    message: String,
                    result: JsResult
                ): Boolean {
                    Log.v("TW", "onJsAlert")
                    if (isFinishing || isDestroyed) {
                        result.cancel()
                        return true
                    }
                    var handled = false
                    try {
                        AlertDialog.Builder(this@FullscreenActivity)
                            .setMessage(message)
                            .setNeutralButton(android.R.string.ok) { _, _ ->
                                handled = true
                                result.confirm()
                            }
                            .setOnDismissListener { if (!handled) result.cancel() }
                            .create()
                            .show()
                    } catch (e: WindowManager.BadTokenException) {
                        // Activity window token invalid between isFinishing check
                        // and show() (e.g. onDestroy scheduled by the system).
                        Log.w("TW", "onJsAlert: window token invalid", e)
                        if (!handled) result.cancel()
                    } catch (e: IllegalStateException) {
                        Log.w("TW", "onJsAlert: illegal state", e)
                        if (!handled) result.cancel()
                    }
                    return true
                }

                override fun onJsConfirm(
                    view: WebView,
                    url: String,
                    message: String,
                    result: JsResult
                ): Boolean {
                    if (isFinishing || isDestroyed) {
                        result.cancel()
                        return true
                    }
                    var handled = false
                    try {
                        AlertDialog.Builder(this@FullscreenActivity)
                            .setMessage(message)
                            .setPositiveButton(android.R.string.ok) { _, _ ->
                                handled = true
                                result.confirm()
                            }
                            .setNegativeButton(android.R.string.cancel) { _, _ ->
                                handled = true
                                result.cancel()
                            }
                            .setOnDismissListener { if (!handled) result.cancel() }
                            .create()
                            .show()
                    } catch (e: WindowManager.BadTokenException) {
                        Log.w("TW", "onJsConfirm: window token invalid", e)
                        if (!handled) result.cancel()
                    } catch (e: IllegalStateException) {
                        Log.w("TW", "onJsConfirm: illegal state", e)
                        if (!handled) result.cancel()
                    }
                    return true
                }
            }
        } catch (e: Throwable) {
            if (!WebViewCompatibilityChecker.isLikelyWebViewInitFailure(e)) {
                throw e
            }
            Log.e("SP-WebView", "Failed to initialize WebView", e)
            return false
        }
        return true
    }

    private fun showWebViewInitFailureOrThrow(message: String, error: Throwable) {
        if (!WebViewCompatibilityChecker.isLikelyWebViewInitFailure(error)) {
            throw error
        }
        showWebViewInitFailure(message, error)
    }

    private fun showWebViewInitFailure(
        message: String,
        error: Throwable? = null,
        compatibility: WebViewCompatibilityChecker.Result? = null,
    ) {
        if (error == null) {
            Log.e("SP-WebView", "$message - finishing activity")
        } else {
            Log.e("SP-WebView", "$message - finishing activity", error)
        }
        WebViewBlockActivity.present(this, webViewInitFailureResult(compatibility))
        finish()
    }

    private fun webViewInitFailureResult(
        compatibility: WebViewCompatibilityChecker.Result? = null,
    ): WebViewCompatibilityChecker.Result =
        (compatibility ?: WebViewCompatibilityChecker.Result(
            status = WebViewCompatibilityChecker.Status.BLOCK,
            majorVersion = null,
            providerPackage = null,
            providerVersionName = null,
            source = WebViewCompatibilityChecker.VersionSource.INIT_FAILURE,
        )).copy(
            status = WebViewCompatibilityChecker.Status.BLOCK,
            source = WebViewCompatibilityChecker.VersionSource.INIT_FAILURE,
        )


    private fun callJSInterfaceFunctionIfExists(fnName: String, objectPath: String, fnParam: String = "") {
        if (!::javaScriptInterface.isInitialized) {
            Log.w("TW", "javaScriptInterface not initialized yet. Skipping JS call.")
            return
        }
        val fnFullName = "window.$WINDOW_INTERFACE_PROPERTY.$objectPath.$fnName"
        val fullObjectPath = "window.$WINDOW_INTERFACE_PROPERTY.$objectPath"
        javaScriptInterface.callJavaScriptFunction("if($fullObjectPath && $fnFullName)$fnFullName($fnParam)")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            Log.v("TW", "onBackPressed canGoBack=true")
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        // Ensure wvContainer is initialized before removing the view
        if (::wvContainer.isInitialized) {
            wvContainer.removeView(webView)
        }
        if (isForegroundServiceFailureReceiverRegistered) {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(
                foregroundServiceFailureReceiver
            )
            isForegroundServiceFailureReceiverRegistered = false
        }
        super.onDestroy()
    }

    companion object {
        const val WINDOW_INTERFACE_PROPERTY: String = "SUPAndroid"
        const val WINDOW_PROPERTY_F_DROID: String = "SUPFDroid"
    }


    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        // Restore scoped storage permission on Android 10+
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Mandatory for Activity, but not for Fragment & ComponentActivity
        //storageHelper.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }
}
