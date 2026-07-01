package com.superproductivity.superproductivity.review

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * play flavor: launches the native Google Play In-App Review card.
 *
 * Per Play policy the flow is opaque — we get no signal about whether the card
 * was shown or what the user did, and Play enforces its own display quota, so
 * we simply request-then-launch and ignore the outcome. If the flow can't be
 * obtained (offline, unsupported device, quota), we fall back to opening the
 * Play Store listing so the user still has a path to rate.
 */
object InAppReview {
    private const val TAG = "InAppReview"
    private const val PLAY_URL =
        "https://play.google.com/store/apps/details?id=com.superproductivity.superproductivity"

    fun request(activity: Activity) {
        try {
            val manager = ReviewManagerFactory.create(activity)
            manager.requestReviewFlow().addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    manager.launchReviewFlow(activity, task.result)
                } else {
                    Log.w(TAG, "requestReviewFlow failed; opening Play listing", task.exception)
                    openPlayListing(activity)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "In-app review unavailable; opening Play listing", e)
            openPlayListing(activity)
        }
    }

    private fun openPlayListing(activity: Activity) {
        try {
            activity.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(PLAY_URL)).apply {
                    setPackage("com.android.vending")
                }
            )
        } catch (e: Exception) {
            // Play Store app is absent → fall back to a plain view intent so a
            // browser can still open the listing.
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PLAY_URL)))
            } catch (e2: Exception) {
                Log.e(TAG, "Unable to open Play Store listing", e2)
            }
        }
    }
}
