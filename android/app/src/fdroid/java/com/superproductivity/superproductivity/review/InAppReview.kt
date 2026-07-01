package com.superproductivity.superproductivity.review

import android.app.Activity

/**
 * fdroid flavor: intentional no-op.
 *
 * F-Droid has no store ratings and the build must stay free of the proprietary
 * Play Core library, so there is nothing to launch here. The web layer detects
 * F-Droid via the SUPFDroid bridge (IS_F_DROID_APP) and never calls
 * requestReview() on the fdroid flavor; this stub exists only so the shared
 * bridge in :main compiles for both flavors.
 */
object InAppReview {
    @Suppress("UNUSED_PARAMETER")
    fun request(activity: Activity) {
        // no-op — see class doc
    }
}
