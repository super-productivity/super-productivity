package com.superproductivity.superproductivity.review

import android.app.Activity
import android.util.Log
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * play flavor: launches the native Google Play In-App Review card.
 *
 * Per Play policy the flow is opaque — we get no signal about whether the card
 * was shown or what the user did, and Play enforces its own display quota, so
 * we simply request-then-launch and ignore the outcome.
 *
 * On failure (offline, unsupported device, quota) we log and abandon. We do NOT
 * fall back to opening the Play Store listing: the review request is triggered
 * automatically at a "productive win", not by a user tapping "Rate", so yanking
 * the user out to the Play Store would be a surprising, unrequested context
 * switch. This also matches Google's guidance that a failed in-app review flow
 * must not alter the user's normal flow.
 */
object InAppReview {
    private const val TAG = "InAppReview"

    fun request(activity: Activity) {
        try {
            val manager = ReviewManagerFactory.create(activity)
            manager.requestReviewFlow().addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    manager.launchReviewFlow(activity, task.result)
                } else {
                    // Log and abandon — do not redirect the user (see class doc).
                    Log.w(TAG, "requestReviewFlow failed; skipping", task.exception)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "In-app review unavailable; skipping", e)
        }
    }
}
