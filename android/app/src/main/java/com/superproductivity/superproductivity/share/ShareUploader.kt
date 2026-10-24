package com.superproductivity.superproductivity.share

import android.content.Context
import android.util.Log
import com.superproductivity.superproductivity.crypto.CaptureSeal
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.widget.CaptureInbox
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Uploads one share entry of the [CaptureInbox] to SuperSync capture
 * (`POST /api/capture/items`), sealed on this device, so other devices get
 * the task on their next sync without this app opening.
 *
 * Called right after the share and by [ShareUploadWorker] as its retry. The
 * server dedupes by the capture id, so a repeated attempt never adds a second
 * item; [CaptureInbox.beginUpload] keeps two attempts from running at once.
 * Logs ids and status codes only, never content.
 */
object ShareUploader {
    private const val TAG = "SP_SHARE"
    private val JSON = "application/json; charset=utf-8".toMediaType()

    /** Well under CaptureInbox.SEND_LEASE_MS, so an entry is never released mid-request. */
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    enum class Outcome {
        /** On the server, or no longer this upload's to send. */
        DONE,

        /** Handed back to the app, which imports it on its next open. */
        RELEASED,

        /** Transient: try again later. */
        RETRY,
    }

    /** What a response status means for the entry. */
    internal fun outcomeFor(status: Int): Outcome = when {
        status in 200..299 -> Outcome.DONE
        status == 408 || status == 429 || status >= 500 -> Outcome.RETRY
        // 409 (switched off, other key, full), 401, 404 (no capture on this
        // server) and the rest are answers, not failures: keep it local.
        else -> Outcome.RELEASED
    }

    /** The v1 payload as stored in the entry, without the inbox's own fields. */
    internal fun payloadOf(entry: JSONObject): JSONObject {
        val payload = JSONObject()
        for (key in listOf("v", "title", "notes", "link", "createdAt", "client")) {
            if (entry.has(key)) payload.put(key, entry.get(key))
        }
        return payload
    }

    fun attempt(context: Context, id: String): Outcome {
        val inbox = CaptureInbox.forContext(context)
        val entry = when (val start = inbox.beginUpload(id)) {
            is CaptureInbox.UploadStart.Done -> return Outcome.DONE
            is CaptureInbox.UploadStart.Busy -> return Outcome.RETRY
            is CaptureInbox.UploadStart.Ready -> start.entry
        }
        val publicKey = CaptureKeyStore.get(context)
        val credentials = BackgroundSyncCredentialStore.get(context)
        val payload = payloadOf(entry)
        if (publicKey == null || credentials == null || !SharePayload.isUploadable(payload)) {
            inbox.releaseUpload(id)
            return Outcome.RELEASED
        }
        val body = try {
            JSONObject()
                .put("id", id)
                .put("fingerprint", CaptureSeal.fingerprint(publicKey))
                .put(
                    "ciphertext",
                    CaptureSeal.seal(publicKey, id, payload.toString().toByteArray(Charsets.UTF_8)),
                )
        } catch (e: Exception) {
            Log.w(TAG, "Share $id could not be sealed, keeping it local", e)
            inbox.releaseUpload(id)
            return Outcome.RELEASED
        }
        val request = Request.Builder()
            .url("${credentials.baseUrl.trimEnd('/')}/api/capture/items")
            .header("Authorization", "Bearer ${credentials.accessToken}")
            .post(body.toString().toRequestBody(JSON))
            .build()
        val outcome = try {
            httpClient.newCall(request).execute().use { response ->
                Log.d(TAG, "Share $id upload answered ${response.code}")
                outcomeFor(response.code)
            }
        } catch (e: IOException) {
            Log.d(TAG, "Share $id upload failed: ${e.javaClass.simpleName}")
            Outcome.RETRY
        }
        when (outcome) {
            Outcome.DONE -> inbox.acknowledge(id)
            Outcome.RELEASED -> inbox.releaseUpload(id)
            Outcome.RETRY -> inbox.endUploadAttempt(id)
        }
        return outcome
    }

    /** Gives up after the worker's last attempt: the app imports it. */
    fun release(context: Context, id: String) {
        CaptureInbox.forContext(context).releaseUpload(id)
    }
}
