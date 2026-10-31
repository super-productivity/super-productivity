package com.superproductivity.superproductivity.share

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import com.superproductivity.superproductivity.R
import com.superproductivity.superproductivity.widget.CaptureInbox

/**
 * Invisible target for text shares (`ACTION_SEND` with a `text/` type).
 * Saves the share to the [CaptureInbox] and finishes at once: no WebView, and
 * the user stays in the app they shared from. The app turns the entry into an
 * Inbox task when it next opens; with SuperSync capture on, [ShareUploader]
 * also sends it to the server so other devices get it first
 * (docs/plans/2026-10-24-android-share-capture.md).
 *
 * Theme.NoDisplay: the activity must finish before onResume, so everything
 * runs inside onCreate and finish() is in a finally.
 */
class ShareReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            // A recreation must not save the same share twice.
            if (savedInstanceState == null) handleShare(intent)
        } finally {
            finish()
        }
    }

    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) {
            return
        }
        // getCharSequenceExtra: getStringExtra returns null for styled (Spanned) text.
        val payload = SharePayload.build(
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(),
            subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString(),
            title = intent.getCharSequenceExtra(Intent.EXTRA_TITLE)?.toString(),
        )
        if (payload == null) {
            toast(R.string.share_empty)
            return
        }
        val isUpload = CaptureKeyStore.get(this) != null && SharePayload.isUploadable(payload)
        val id = try {
            CaptureInbox.forContext(this).addShare(payload, isUpload)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save share", e)
            toast(R.string.share_failed)
            return
        }
        // Shape only, never the content: logcat ends up in bug reports.
        Log.d(TAG, "Saved share $id upload=$isUpload")
        toast(R.string.share_saved)
        if (isUpload) {
            val appContext = applicationContext
            ShareUploadWorker.enqueue(appContext, id)
            // The cached process usually outlives the activity long enough for
            // one request; the worker retries if it does not.
            Thread({
                try {
                    ShareUploader.attempt(appContext, id)
                } catch (e: Exception) {
                    // Never crash the process from here; the worker retries.
                    Log.e(TAG, "Share $id upload attempt failed", e)
                }
            }, "share-upload").start()
        }
    }

    private fun toast(message: Int) {
        Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val TAG = "SP_SHARE"
    }
}
