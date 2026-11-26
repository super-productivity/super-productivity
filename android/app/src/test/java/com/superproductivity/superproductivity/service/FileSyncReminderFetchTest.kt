package com.superproductivity.superproductivity.service

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FileSyncReminderFetchTest {

    private val server = MockWebServer()
    private val client = OkHttpClient()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() = server.shutdown()

    private fun fetch(previousETag: String? = null): SyncFileFetch = fetchSyncFile(
        client,
        BackgroundSyncCredentialStore.FileSyncCredentials(
            server.url("/dav/sync-data.json").toString(),
            "Basic dXNlcjpwYXNz",
            isEncryptionExpected = false,
        ),
        previousETag,
    )

    @Test
    fun `sends auth and the previous ETag, 304 is unchanged`() {
        server.enqueue(MockResponse().setResponseCode(304))
        assertEquals(SyncFileFetch.Unchanged, fetch("\"v1\""))
        val request = server.takeRequest()
        assertEquals("/dav/sync-data.json", request.path)
        assertEquals("Basic dXNlcjpwYXNz", request.getHeader("Authorization"))
        assertEquals("\"v1\"", request.getHeader("If-None-Match"))
    }

    @Test
    fun `first fetch sends no If-None-Match and returns body with ETag`() {
        server.enqueue(MockResponse().setBody("pf_2__{}").setHeader("ETag", "\"v2\""))
        assertEquals(SyncFileFetch.Body("pf_2__{}", "\"v2\""), fetch())
        assertNull(server.takeRequest().getHeader("If-None-Match"))
    }

    @Test
    fun `missing ETag is null`() {
        server.enqueue(MockResponse().setBody("x"))
        assertEquals(SyncFileFetch.Body("x", null), fetch())
    }

    @Test
    fun `server errors retry, client errors skip`() {
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals(SyncFileFetch.Retry("HTTP 503"), fetch())
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(SyncFileFetch.Skip(404), fetch())
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(SyncFileFetch.Skip(401), fetch())
    }

    @Test
    fun `connection failure retries`() {
        server.shutdown()
        assertTrue(fetch() is SyncFileFetch.Retry)
    }

    @Test
    fun `a body at the cap is read, one byte more is too large`() {
        val atCap = "a".repeat(MAX_SYNC_FILE_BYTES.toInt())
        server.enqueue(MockResponse().setBody(atCap))
        assertEquals(MAX_SYNC_FILE_BYTES.toInt(), (fetch() as SyncFileFetch.Body).text.length)

        // chunked: no Content-Length, so the cap must hold while reading
        server.enqueue(MockResponse().setChunkedBody(Buffer().writeUtf8(atCap + "a"), 1 shl 20).setHeader("ETag", "\"big\""))
        assertEquals(SyncFileFetch.TooLarge("\"big\""), fetch())
    }
}
