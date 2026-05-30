package com.superproductivity.superproductivity.webview

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.superproductivity.superproductivity.FullscreenActivity

/**
 * Recovers from a *transient* WebView init failure (#7518) by relaunching the app
 * once, after a short settle delay, before the caller surfaces the terminal block
 * screen. The OS WebView provider is frequently just mid-update / not-yet-resolved
 * at the instant the activity starts; the user's own workaround is to fully close
 * and reopen the app, and this does that automatically.
 *
 * Scope/limitation: this is a *same-process* relaunch (it routes through the
 * MAIN/LAUNCHER activity with a fresh task, mirroring [WebViewBlockActivity]'s
 * existing relaunch). It recovers the "provider not yet resolved" race but NOT a
 * process whose native WebView load has already hard-failed and cached — that
 * would need a true fresh process (e.g. a ProcessPhoenix-style trampoline), which
 * we deliberately avoid for now to keep this dependency-free and within Android's
 * background-activity-launch rules. A genuinely broken provider therefore still
 * reaches the block screen (no regression).
 *
 * Loop prevention lives in [WebViewCompatibilityChecker]: the retry budget is only
 * spent at the moment we actually relaunch ([WebViewCompatibilityChecker.recordInitFailureRetry]),
 * and a relaunch that re-fails within the window is denied by
 * [WebViewCompatibilityChecker.canRetryInitFailure], falling through to the block screen.
 */
object WebViewRecovery {
    private const val TAG = "WebViewRecovery"

    // Delay before the relaunch, giving a mid-update / not-yet-resolved provider a
    // moment to settle. ~2.5s roughly matches the "close the app and reopen"
    // interval that already works for users. → issue #7518.
    private const val RELAUNCH_DELAY_MS = 2500L

    /**
     * Schedules the one-shot *automatic* recovery relaunch (after a settle delay).
     * The caller must have already confirmed
     * [WebViewCompatibilityChecker.canRetryInitFailure] and must return immediately
     * afterwards without continuing to use the (doomed) WebView.
     */
    fun scheduleRelaunch(activity: Activity) {
        Handler(Looper.getMainLooper()).postDelayed({
            if (activity.isFinishing || activity.isDestroyed) {
                return@postDelayed
            }
            // Spend the retry budget only now that we're actually relaunching, so a
            // user who kills the app during the delay doesn't waste the one shot and
            // gets a fresh auto-retry on their next manual launch.
            WebViewCompatibilityChecker.recordInitFailureRetry(activity)
            Log.w(TAG, "Auto-relaunching to recover from transient WebView init failure")
            relaunchNow(activity)
        }, RELAUNCH_DELAY_MS)
    }

    /**
     * Relaunches the app immediately from the MAIN/LAUNCHER activity. Used for
     * user-initiated recovery (the block screen's "Retry" / "Try anyway"), where no
     * settle delay or retry-budget accounting applies.
     *
     * Always targets [FullscreenActivity] explicitly rather than
     * PackageManager.getLaunchIntentForPackage, which can return null in stripped
     * Android variants and would leave the user on an empty screen. FullscreenActivity
     * itself routes via LaunchDecider to CapacitorMainActivity when appropriate.
     */
    fun relaunchNow(activity: Activity) {
        activity.startActivity(
            Intent(activity, FullscreenActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        activity.finish()
    }
}
