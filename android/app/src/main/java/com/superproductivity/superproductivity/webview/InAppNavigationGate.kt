package com.superproductivity.superproductivity.webview

import java.net.URI
import java.net.URISyntaxException

/**
 * Decides whether an http(s) navigation may stay inside the legacy online
 * WebView. That WebView carries the full SUPAndroid bridge (DB reads including
 * local backups, sync credentials), so only the configured app origin may load
 * there; anything else opens in the external browser (#8832). Unparseable URLs
 * fail closed to the browser too.
 */
object InAppNavigationGate {
    /** Matches the parsed scheme and host exactly, never a substring of the whole URL. */
    fun isInAppUrl(url: String, serviceProtocol: String, serviceHost: String): Boolean {
        val uri = try {
            URI(url)
        } catch (e: URISyntaxException) {
            return false
        }
        // serviceHost may carry a port, e.g. "10.0.2.2:4200" for emulator dev builds.
        return uri.scheme.equals(serviceProtocol, ignoreCase = true) &&
            uri.host.equals(serviceHost.substringBefore(':'), ignoreCase = true)
    }
}
