package com.superproductivity.superproductivity

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.superproductivity.superproductivity.app.LaunchDecider

/**
 * Invisible trampoline for the launcher shortcuts declared in res/xml/shortcuts.xml
 * (New task / Today / Inbox — the same set as the iOS Home Screen quick actions).
 *
 * The shortcuts can't target CapacitorMainActivity directly: Android always starts
 * a static shortcut's first intent with FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK,
 * which would destroy a running app's WebView and cold-reload it on every tap.
 * Starting from here (own empty taskAffinity, finished immediately) instead brings
 * the existing singleTask CapacitorMainActivity forward via onNewIntent, or creates
 * it on a cold start. Either way Capacitor emits `appUrlOpen` with the shortcut's
 * `com.super-productivity.app://<host>` URL and parse-app-uri-quick-action.ts
 * handles it — the same path as the iOS quick actions and any other deep link.
 */
class AppShortcutActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Legacy online-mode installs still run FullscreenActivity, which has no
        // Capacitor bridge to handle the URL; just open the app for them rather
        // than starting the offline activity on a different data store.
        val launchIntent = if (LaunchDecider(this).shouldSwitchToNewActivity()) {
            Intent(this, CapacitorMainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                data = intent.data
            }
        } else {
            Intent(this, FullscreenActivity::class.java)
        }
        startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }
}
