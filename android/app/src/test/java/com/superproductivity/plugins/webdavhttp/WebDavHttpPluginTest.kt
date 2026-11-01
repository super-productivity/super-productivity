package com.superproductivity.plugins.webdavhttp

import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.Dns
import okhttp3.EventListener
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class WebDavHttpPluginTest {
    @Test
    fun `timed out PUT is not replayed while the original upload holds a lock`() {
        withStalledRequest { client, url, requests ->
            val request = Request.Builder().url(url).put("snapshot".toRequestBody()).build()

            assertThrows(SocketTimeoutException::class.java) {
                client.newCall(request).execute().use {
                    throw AssertionError("Expected upload timeout, received HTTP ${it.code}")
                }
            }
            assertEquals("Only the original upload should reach the server", 1, requests.get())
        }
    }

    @Test
    fun `read requests retain recovery after a timeout`() {
        withStalledRequest { client, url, requests ->
            client.newCall(Request.Builder().url(url).build()).execute().use {
                assertEquals(200, it.code)
            }
            assertEquals(2, requests.get())
        }
    }

    @Test
    fun `PUT retries a refused connection before sending any bytes`() {
        val attempts = AtomicInteger()
        val port = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1")).use { it.localPort }
        val client = newTestClientBuilder().eventListener(object : EventListener() {
            override fun connectStart(call: Call, address: InetSocketAddress, proxy: Proxy) {
                attempts.incrementAndGet()
            }
        }).build()
        try {
            val request = Request.Builder().url("http://127.0.0.1:$port/sync-state.json")
                .put("snapshot".toRequestBody()).build()
            assertThrows(ConnectException::class.java) {
                client.newCall(request).execute().close()
            }
            assertEquals(2, attempts.get())
        } finally {
            closeTestClient(client)
        }
    }

    @Test
    fun `PUT retains retries when DNS lookup fails`() {
        val lookups = AtomicInteger()
        val client = newTestClientBuilder().dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                lookups.incrementAndGet()
                throw UnknownHostException("Simulated transient DNS failure")
            }
        }).build()
        try {
            val request = Request.Builder().url("http://webdav.invalid/sync-state.json")
                .put("snapshot".toRequestBody()).build()
            assertThrows(UnknownHostException::class.java) {
                client.newCall(request).execute().close()
            }
            assertEquals(2, lookups.get())
        } finally {
            closeTestClient(client)
        }
    }

    @Test
    fun `resends the session cookie a WebDAV server set on later requests (#10839)`() {
        // pCloud treats every cookie-less request as a new login and emails the user.
        // Another account on the same host must not inherit the session: Nextcloud
        // authenticates a DAV session cookie without checking Basic credentials.
        val cookieHeaders = mutableListOf<String?>()
        val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        val executor = Executors.newSingleThreadExecutor()
        executor.submit {
            repeat(3) { index ->
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    reader.readLine()
                    var cookie: String? = null
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        if (line.startsWith("Cookie:", ignoreCase = true)) {
                            cookie = line.substringAfter(':').trim()
                        }
                    }
                    synchronized(cookieHeaders) { cookieHeaders.add(cookie) }
                    val setCookie = if (index == 0) "Set-Cookie: session=s1; Path=/; HttpOnly\r\n" else ""
                    socket.getOutputStream().write(
                        "HTTP/1.1 200 OK\r\n${setCookie}Content-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()
                    )
                }
            }
        }
        val client = newTestClientBuilder().build()
        try {
            val url = "http://127.0.0.1:${server.localPort}/dav/sync-data.json"
            // Unique credentials also reset any cookie other tests left for this host.
            for (auth in listOf("Basic cookie-a", "Basic cookie-a", "Basic cookie-b")) {
                val request = Request.Builder().url(url).header("Authorization", auth).build()
                client.newCall(request).execute().close()
            }
            assertEquals(
                listOf(null, "session=s1", null),
                synchronized(cookieHeaders) { cookieHeaders.toList() },
            )
        } finally {
            server.close()
            executor.shutdownNow()
            closeTestClient(client)
        }
    }

    @Test
    fun `credential change drops cookies on every path of the host (#10839)`() {
        val jar = WebDavSessionCookieJar()
        val davUrl = "https://dav.example.com/dav/sync-data.json".toHttpUrl()
        fun requestTo(path: String, auth: String) =
            Request.Builder().url("https://dav.example.com$path").header("Authorization", auth).build()

        jar.beginRequest(requestTo("/dav/sync-data.json", "Basic a"))
        jar.saveFromResponse(davUrl, listOfNotNull(Cookie.parse(davUrl, "session=s1; Path=/dav")))
        jar.beginRequest(requestTo("/other", "Basic b"))
        assertTrue(jar.loadForRequest(davUrl).isEmpty())
    }

    private fun newTestClientBuilder(): OkHttpClient.Builder {
        // Exercise the production client's interceptors over real sockets.
        // Shorten only the timeout so the regression does not take 30 seconds.
        val field = WebDavHttpPlugin::class.java.getDeclaredField("client")
        field.isAccessible = true
        return (field.get(null) as OkHttpClient).newBuilder()
            .dispatcher(Dispatcher())
            .connectionPool(ConnectionPool())
            .proxy(Proxy.NO_PROXY)
            .readTimeout(2, TimeUnit.SECONDS)
    }

    private fun closeTestClient(client: OkHttpClient) {
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    private fun withStalledRequest(test: (OkHttpClient, String, AtomicInteger) -> Unit) {
        val client = newTestClientBuilder().build()
        val requests = AtomicInteger()
        val releaseOriginal = CountDownLatch(1)
        val executor = Executors.newCachedThreadPool()
        val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        executor.submit {
            try {
                while (!server.isClosed) {
                    val socket = server.accept()
                    executor.submit {
                        socket.use {
                            socket.soTimeout = 3000
                            val reader = socket.getInputStream().bufferedReader()
                            val method = reader.readLine().substringBefore(' ')
                            var length = 0
                            while (true) {
                                val line = reader.readLine()
                                if (line.isEmpty()) break
                                if (line.startsWith("Content-Length:", ignoreCase = true)) {
                                    length = line.substringAfter(':').trim().toInt()
                                }
                            }
                            repeat(length) { reader.read() }
                            if (requests.incrementAndGet() == 1) {
                                releaseOriginal.await(10, TimeUnit.SECONDS)
                            } else {
                                // A duplicate upload collides with the first one's lock.
                                val status = if (method == "PUT") "423 Locked" else "200 OK"
                                socket.getOutputStream().write(
                                    "HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()
                                )
                            }
                        }
                    }
                }
            } catch (e: SocketException) {
                if (!server.isClosed) throw e
            }
        }
        try {
            test(client, "http://127.0.0.1:${server.localPort}/sync-state.json", requests)
        } finally {
            releaseOriginal.countDown()
            server.close()
            executor.shutdownNow()
            closeTestClient(client)
        }
    }
}
