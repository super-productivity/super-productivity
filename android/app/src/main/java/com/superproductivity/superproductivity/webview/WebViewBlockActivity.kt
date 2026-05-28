package com.superproductivity.superproductivity.webview

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.superproductivity.superproductivity.FullscreenActivity
import com.superproductivity.superproductivity.R

class WebViewBlockActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_webview_block)

        // Defense-in-depth against tapjacking: the override below is the only path to
        // permanently disable the WebView block, so we drop touches when the window
        // is partially obscured by an overlay app.
        findViewById<View>(android.R.id.content).filterTouchesWhenObscured = true

        val minVersion = intent.getIntExtra(EXTRA_MIN_VERSION, WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION)
        val detectedVersion = intent.getIntExtra(EXTRA_VERSION_MAJOR, -1)
        val versionName = intent.getStringExtra(EXTRA_VERSION_NAME)
        val provider = intent.getStringExtra(EXTRA_PROVIDER_PACKAGE)
        val providerPackageIsCurrent = intent.getBooleanExtra(EXTRA_PROVIDER_PACKAGE_IS_CURRENT, false)
        val source = WebViewCompatibilityChecker.sourceFromName(intent.getStringExtra(EXTRA_SOURCE))
        val config = WebViewCompatibilityChecker.blockScreenConfig(
            source = source,
            hasProviderDetails = detectedVersion > 0 || !versionName.isNullOrBlank() || !provider.isNullOrBlank(),
        )

        val message = if (config.titleResId == R.string.webview_block_message) {
            getString(config.titleResId, minVersion)
        } else {
            getString(config.titleResId)
        }
        findViewById<TextView>(R.id.webview_block_title).text = message

        val details = buildString {
            config.detailsIntroResId?.let {
                append(getString(it))
                append("\n\n")
            }
            if (detectedVersion > 0) {
                append(getString(R.string.webview_block_detected_major, detectedVersion))
                append("\n")
            }
            if (!versionName.isNullOrBlank()) {
                append(getString(R.string.webview_block_detected_full, versionName))
                append("\n")
            }
            if (!provider.isNullOrBlank()) {
                append(getString(R.string.webview_block_provider, provider))
                append("\n")
            }
            if (config.showSource) {
                append(getString(R.string.webview_block_source, source.name))
                append("\n")
            }
        }.trim()
        findViewById<TextView>(R.id.webview_block_details).text = details

        val updateButton = findViewById<Button>(R.id.webview_block_update)
        if (config.action == WebViewCompatibilityChecker.BlockScreenAction.OPEN_WEBVIEW_SETTINGS_WITH_WARNING) {
            updateButton.setText(R.string.webview_block_open_settings)
            updateButton.setOnClickListener {
                showOpenWebViewConfirmation(provider, useUpdatePage = false)
            }
        } else {
            if (!providerPackageIsCurrent) {
                updateButton.setText(R.string.webview_block_open_settings)
            }
            updateButton.setOnClickListener {
                if (providerPackageIsCurrent) {
                    showOpenWebViewConfirmation(provider, useUpdatePage = true)
                } else {
                    showOpenWebViewConfirmation(null, useUpdatePage = false)
                }
            }
        }

        findViewById<Button>(R.id.webview_block_close).setOnClickListener {
            finishAffinity()
        }

        val tryAnywayButton = findViewById<Button>(R.id.webview_block_try_anyway)
        if (config.showTryAnyway) {
            tryAnywayButton.setOnClickListener {
                showOverrideConfirmation(minVersion)
            }
        } else {
            tryAnywayButton.visibility = View.GONE
        }
    }

    private fun showOpenWebViewConfirmation(provider: String?, useUpdatePage: Boolean) {
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.webview_manage_warning_title)
            .setMessage(R.string.webview_manage_warning_message)
            .setPositiveButton(R.string.webview_manage_warning_continue) { _, _ ->
                if (useUpdatePage) {
                    WebViewCompatibilityChecker.openWebViewUpdatePage(this, provider)
                } else {
                    WebViewCompatibilityChecker.openWebViewSettingsPage(this, provider)
                }
            }
            .setNegativeButton(R.string.webview_override_warning_cancel, null)
            .setCancelable(true)
            .show()
        dialog.window?.decorView?.filterTouchesWhenObscured = true
    }

    private fun showOverrideConfirmation(minVersion: Int) {
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.webview_override_warning_title)
            .setMessage(getString(R.string.webview_override_warning_message, minVersion))
            .setPositiveButton(R.string.webview_override_warning_continue) { _, _ ->
                WebViewCompatibilityChecker.setBlockOverride(this, true)
                relaunchApp()
            }
            .setNegativeButton(R.string.webview_override_warning_cancel, null)
            .setCancelable(true)
            .show()
        dialog.window?.decorView?.filterTouchesWhenObscured = true
    }

    private fun relaunchApp() {
        // Always launch FullscreenActivity (the manifest's MAIN/LAUNCHER) explicitly
        // rather than via PackageManager.getLaunchIntentForPackage, which can return
        // null in stripped Android variants and would leave the user with an empty
        // screen after tapping confirm. FullscreenActivity itself routes via
        // LaunchDecider to CapacitorMainActivity when appropriate.
        val launchIntent = Intent(this, FullscreenActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(launchIntent)
        finish()
    }

    companion object {
        private const val EXTRA_VERSION_MAJOR = "extra_version_major"
        private const val EXTRA_VERSION_NAME = "extra_version_name"
        private const val EXTRA_PROVIDER_PACKAGE = "extra_provider_package"
        private const val EXTRA_PROVIDER_PACKAGE_IS_CURRENT = "extra_provider_package_is_current"
        private const val EXTRA_MIN_VERSION = "extra_min_version"
        private const val EXTRA_SOURCE = "extra_source"

        fun present(host: Activity, result: WebViewCompatibilityChecker.Result) {
            val intent =
                Intent(host, WebViewBlockActivity::class.java)
                    .putExtra(EXTRA_VERSION_MAJOR, result.majorVersion ?: -1)
                    .putExtra(EXTRA_VERSION_NAME, result.providerVersionName)
                    .putExtra(EXTRA_PROVIDER_PACKAGE, result.providerPackage)
                    .putExtra(EXTRA_PROVIDER_PACKAGE_IS_CURRENT, result.providerPackageIsCurrent)
                    .putExtra(EXTRA_MIN_VERSION, WebViewCompatibilityChecker.MIN_CHROMIUM_VERSION)
                    .putExtra(EXTRA_SOURCE, result.source.name)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)

            host.startActivity(intent)
        }
    }
}
