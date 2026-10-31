package com.superproductivity.plugins.webdavhttp

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.Request
import java.security.MessageDigest

/**
 * In-memory session cookies for WebDAV requests (#10839). OkHttp drops cookies by
 * default, so a server that tracks an authorized session by cookie (pCloud) saw every
 * sync as a fresh login and emailed the user a security alert each time.
 *
 * Process lifetime only: never persisted, never logged. A host's cookies are dropped
 * when its credentials change: Nextcloud accepts a DAV session cookie without checking
 * the Basic credentials, so a stale cookie would keep syncing into the previous account.
 */
internal class WebDavSessionCookieJar : CookieJar {
    private val cookies = mutableListOf<Cookie>()
    private val credentialsHashByHost = mutableMapOf<String, String>()

    /** Call before each request is sent; drops cookies set for other credentials. */
    @Synchronized
    fun beginRequest(request: Request) {
        val url = request.url
        // Hashed so the jar holds no second copy of the credentials.
        val credentialsHash = MessageDigest.getInstance("SHA-256")
            .digest((request.header("Authorization") ?: "").toByteArray())
            .joinToString("") { "%02x".format(it) }
        if (credentialsHashByHost.put(url.host, credentialsHash) != credentialsHash) {
            // Whole host, not just this path: a sub-path cookie would otherwise
            // survive and be sent with the new credentials.
            cookies.removeAll {
                it.domain == url.host || (!it.hostOnly && url.host.endsWith(".${it.domain}"))
            }
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        for (cookie in cookies) {
            this.cookies.removeAll {
                it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path
            }
            // A server expires a cookie by resending it with Max-Age=0 or a past date.
            if (cookie.expiresAt > now) {
                this.cookies.add(cookie)
            }
        }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        cookies.removeAll { it.expiresAt <= now }
        return cookies.filter { it.matches(url) }
    }
}
