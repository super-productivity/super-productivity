package com.superproductivity.plugins.webdavhttp

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.net.SocketTimeoutException
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

    private fun withStalledRequest(test: (OkHttpClient, String, AtomicInteger) -> Unit) {
        // Exercise the production client's interceptors over real sockets.
        // Shorten only the timeout so the regression does not take 30 seconds.
        val field = WebDavHttpPlugin::class.java.getDeclaredField("client")
        field.isAccessible = true
        val client = (field.get(null) as OkHttpClient).newBuilder()
            .readTimeout(500, TimeUnit.MILLISECONDS)
            .build()
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
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
        }
    }
}
