package com.superproductivity.superproductivity.webview

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import com.superproductivity.superproductivity.R


class WebHelper {

    @SuppressLint("SetJavaScriptEnabled")
    fun instanceView(context: Context, modifyUA: Boolean = true) : WebView {
        val wv = WebView(context)
        wv.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.MATCH_PARENT)

        return setupView(wv, modifyUA)
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun setupView(wv: WebView, modifyUA: Boolean) : WebView {
        // Use the platform default layer type. Forcing LAYER_TYPE_HARDWARE (added in
        // 2021's "enable hardware acceleration" commit) isn't needed for GPU
        // acceleration — that comes from android:hardwareAccelerated="true" in the
        // manifest. Rendering the WebView into a view-level off-screen texture is the
        // likely cause of the blank/white screen some users report after backgrounding
        // and returning (Play Store review; not locally reproducible).
        wv.setLayerType(View.LAYER_TYPE_NONE, null)
        wv.isFocusableInTouchMode = true

        // Paint the WebView surface in the theme background so the adjustResize
        // keyboard animation never reveals the default white backing surface
        // between layout and the next page repaint. Follows the system
        // light/dark mode via the values-night resource qualifier.
        wv.setBackgroundColor(ContextCompat.getColor(wv.context, R.color.windowBackground))

        // additional web view settings
        val wSettings = wv.settings

        wSettings.javaScriptEnabled = true
        wSettings.loadsImagesAutomatically = true
        wSettings.domStorageEnabled = true
        wSettings.loadWithOverviewMode = true
        wSettings.databaseEnabled = true
        wSettings.allowFileAccess = true
        wSettings.setGeolocationEnabled(true)
        wSettings.mediaPlaybackRequiresUserGesture = false
        wSettings.javaScriptCanOpenWindowsAutomatically = true
        wSettings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        wSettings.allowUniversalAccessFromFileURLs = true
        wSettings.allowContentAccess = true
        // allow google login
        // @see https://stackoverflow.com/questions/45863004/how-some-apps-are-able-to-perform-google-login-successfully-in-android-webview
        // Force links and redirects to open in the WebView instead of in a browser
        wSettings.javaScriptCanOpenWindowsAutomatically = true
        if (modifyUA) {
            wSettings.userAgentString =
                "Mozilla/5.0 (Linux Android 5.0 SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.125 Mobile Safari/537.36"
        } else {
            // IMPORTANT: Do not remove or modify "; wv" in the User-Agent string.
            // Removing "; wv" prevents Service Workers from registering and functioning correctly in Capacitor.
        }
        return wv
    }
}
