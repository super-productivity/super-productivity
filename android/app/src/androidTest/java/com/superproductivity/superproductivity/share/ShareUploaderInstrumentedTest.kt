package com.superproductivity.superproductivity.share

import android.content.Context
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.crypto.CaptureSeal
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.widget.CaptureInbox
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * [ShareUploader.attempt] against a local server: the request it sends and
 * the inbox state each answer leaves, which the JVM tests of its pure parts
 * cannot reach (credentials live in the real Keystore-backed store).
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class ShareUploaderInstrumentedTest {

    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext

    private val inbox: CaptureInbox
        get() = CaptureInbox.forContext(context)

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cleanUp()
        BackgroundSyncCredentialStore.save(context, server.url("/").toString(), TOKEN)
        CaptureKeyStore.set(context, USER_SPKI)
    }

    @After
    fun tearDown() {
        cleanUp()
        server.shutdown()
    }

    private fun cleanUp() {
        BackgroundSyncCredentialStore.clear(context)
        CaptureKeyStore.set(context, "")
        File(context.noBackupFilesDir, "capture-inbox").deleteRecursively()
    }

    private fun addUploadingShare(): String {
        val payload = SharePayload.build(
            text = "https://example.com/article",
            subject = "Example article",
            title = null,
        )!!
        return inbox.addShare(payload, isUpload = true)
    }

    private fun importableIds(): List<String> {
        val shares = JSONArray(inbox.pendingSharesJson())
        return (0 until shares.length()).map { shares.getJSONObject(it).getString("id") }
    }

    @Test
    fun sendsTheSealedShareAndDeletesItOnceStored() {
        val id = addUploadingShare()
        server.enqueue(MockResponse().setBody("""{"status":"queued"}"""))

        assertEquals(ShareUploader.Outcome.DONE, ShareUploader.attempt(context, id))

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/capture/items", request.requestUrl?.encodedPath)
        assertEquals("Bearer $TOKEN", request.getHeader("Authorization"))
        val body = JSONObject(request.body.readUtf8())
        assertEquals(id, body.getString("id"))
        assertEquals(CaptureSeal.fingerprint(USER_SPKI), body.getString("fingerprint"))
        val sealed = Base64.decode(body.getString("ciphertext"), Base64.DEFAULT)
        assertEquals(1, sealed[0].toInt())
        assertTrue("content must not travel in the clear", "example.com" !in body.toString())

        // Gone: neither imported by the app nor uploaded again.
        assertEquals(emptyList<String>(), importableIds())
        assertTrue(inbox.beginUpload(id) is CaptureInbox.UploadStart.Done)
    }

    @Test
    fun aRefusalHandsTheShareToTheApp() {
        val id = addUploadingShare()
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"key_mismatch"}"""))

        assertEquals(ShareUploader.Outcome.RELEASED, ShareUploader.attempt(context, id))
        assertEquals(listOf(id), importableIds())
    }

    @Test
    fun aServerErrorKeepsTheUploadAndFreesItForTheNextAttempt() {
        val id = addUploadingShare()
        server.enqueue(MockResponse().setResponseCode(503))

        assertEquals(ShareUploader.Outcome.RETRY, ShareUploader.attempt(context, id))
        assertEquals(emptyList<String>(), importableIds())
        assertTrue(inbox.beginUpload(id) is CaptureInbox.UploadStart.Ready)
    }

    @Test
    fun aDroppedConnectionIsRetried() {
        val id = addUploadingShare()
        // OkHttp may retry a failed connection once by itself.
        repeat(3) {
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        }

        assertEquals(ShareUploader.Outcome.RETRY, ShareUploader.attempt(context, id))
        assertEquals(emptyList<String>(), importableIds())
        assertTrue(inbox.beginUpload(id) is CaptureInbox.UploadStart.Ready)
    }

    @Test
    fun withoutACaptureKeyItStaysLocalAndSendsNothing() {
        val id = addUploadingShare()
        CaptureKeyStore.set(context, "")

        assertEquals(ShareUploader.Outcome.RELEASED, ShareUploader.attempt(context, id))
        assertEquals(0, server.requestCount)
        assertEquals(listOf(id), importableIds())
    }

    private companion object {
        const val TOKEN = "instr-token"

        /** The server's pinned capture test key (CaptureSealTest). */
        const val USER_SPKI =
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEb/A7lJJBzh2t1DUZ5pYOCoW0GmmgXDKBA6orzhWUyhY8T3U6Vb8B3FP2wLDH7ueLQMb/fSWpbiKCuYnO9xwUSg=="
    }
}
