package com.superproductivity.plugins.webdavhttp

import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.Dns
import okhttp3.EventListener
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import java.security.cert.CertificateExpiredException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class WebDavHttpPluginTest {
    private fun handshake(cause: Throwable?) =
        SSLHandshakeException("handshake failed").apply { cause?.let { initCause(it) } }

    @Test
    fun `untrusted issuer is a certificate trust failure`() {
        // Shape Android produces for a server whose CA is not installed (#2855).
        val pathError = CertPathValidatorException("Trust anchor for certification path not found.")
        val certError = CertificateException(pathError)
        assertTrue(isCertificateTrustFailure(handshake(certError)))
    }

    @Test
    fun `expired certificate and host name mismatch are certificate trust failures`() {
        assertTrue(isCertificateTrustFailure(handshake(CertificateExpiredException("expired"))))
        assertTrue(isCertificateTrustFailure(SSLPeerUnverifiedException("Hostname nas.local not verified")))
    }

    @Test
    fun `handshake failures without a certificate cause are not trust failures`() {
        assertFalse(isCertificateTrustFailure(handshake(null)))
        assertFalse(isCertificateTrustFailure(handshake(SocketException("Connection reset"))))
        assertFalse(isCertificateTrustFailure(SSLException("Read error")))
        assertFalse(isCertificateTrustFailure(SocketTimeoutException("timeout")))
    }

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
