package com.superproductivity.superproductivity.webview

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InAppNavigationGateTest {

    private val serviceHost = "app.super-productivity.com"

    private fun staysInApp(url: String, host: String = serviceHost, protocol: String = "https") =
        InAppNavigationGate.isInAppUrl(url, protocol, host)

    @Test
    fun `keeps the app origin in the WebView`() {
        assertTrue(staysInApp("https://app.super-productivity.com/#/tag/TODAY/tasks"))
        assertTrue(staysInApp("HTTPS://APP.SUPER-PRODUCTIVITY.COM/"))
        assertTrue(staysInApp("https://evil@app.super-productivity.com/"))
    }

    @Test
    fun `opens other hosts externally, even first-party ones`() {
        // Only the app needs the bridge; the website and localhost servers of
        // other apps on the device must not get it.
        assertFalse(staysInApp("https://super-productivity.com/"))
        assertFalse(staysInApp("https://test-app.super-productivity.com/"))
        assertFalse(staysInApp("http://localhost:4200/"))
    }

    @Test
    fun `opens a plaintext http link to the https app host externally`() {
        // Plaintext content could be injected on-path and would get the bridge.
        assertFalse(staysInApp("http://app.super-productivity.com/"))
    }

    @Test
    fun `keeps a self-hosted or emulator service host with port in the WebView`() {
        assertTrue(staysInApp("http://10.0.2.2:4200/", host = "10.0.2.2:4200", protocol = "http"))
        assertTrue(staysInApp("https://sp.example.org/", host = "sp.example.org"))
    }

    @Test
    fun `opens a foreign page that only mentions the app host externally (8832)`() {
        // These used to load inside the WebView, which carries the full
        // SUPAndroid bridge (DB reads incl. local backups, sync credentials).
        assertFalse(staysInApp("https://evil.example/super-productivity.com"))
        assertFalse(staysInApp("https://evil.example/?r=app.super-productivity.com"))
        assertFalse(staysInApp("https://evil.example/#localhost"))
        assertFalse(staysInApp("https://super-productivity.com.evil.example/"))
        assertFalse(staysInApp("https://evilsuper-productivity.com/"))
        assertFalse(staysInApp("https://app.super-productivity.com@evil.example/"))
        assertFalse(staysInApp("https://localhost.evil.example/"))
        // Chromium navigates this to evil.example; it must not count as the app host.
        assertFalse(staysInApp("https://evil.example\\@app.super-productivity.com/"))
    }

    @Test
    fun `opens an unparseable http url externally`() {
        assertFalse(staysInApp("https://evil example/super-productivity.com"))
    }
}
