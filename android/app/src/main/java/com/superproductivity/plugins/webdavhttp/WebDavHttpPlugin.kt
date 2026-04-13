package com.superproductivity.plugins.webdavhttp

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import android.util.Log
import javax.net.ssl.SSLHandshakeException

@CapacitorPlugin(name = "WebDavHttp")
class WebDavHttpPlugin : Plugin() {

    companion object {
        // Shared OkHttpClient instance for better resource management
        private val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            // Follow redirects as the TypeScript code expects
            .followRedirects(true)
            .followSslRedirects(true)
            // Add retry interceptor for reliability
            .addInterceptor { chain ->
                val request = chain.request()
                var response: Response? = null
                var tryCount = 0
                val maxRetries = 2
                
                while (tryCount < maxRetries) {
                    try {
                        response = chain.proceed(request)
                        break
                    } catch (e: IOException) {
                        tryCount++
                        if (tryCount >= maxRetries) {
                            throw e
                        }
                        // Wait before retry
                        Thread.sleep(1000L * tryCount)
                    }
                }
                
                response ?: throw IOException("Failed after $maxRetries retries")
            }
            .build()
    }

    @PluginMethod
    fun request(call: PluginCall) {
        // Execute in background to avoid blocking the UI thread
        GlobalScope.launch(Dispatchers.IO) {
            try {
                val result = performRequest(call)
                withContext(Dispatchers.Main) {
                    call.resolve(result)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    handleError(call, e)
                }
            }
        }
    }

    private fun performRequest(call: PluginCall): JSObject {
        val urlString = call.getString("url")
            ?: throw IllegalArgumentException("URL is required")
        val method = call.getString("method") ?: "GET"
        val headers = call.getObject("headers") ?: JSObject()
        val data = call.getString("data")

        // Build request
        val requestBuilder = Request.Builder()
            .url(urlString)

        // Add headers
        headers.keys().forEach { key ->
            headers.getString(key)?.let { value ->
                // Skip content-length header as OkHttp will set it
                if (!key.equals("content-length", ignoreCase = true)) {
                    requestBuilder.addHeader(key, value)
                }
            }
        }

        // Log payload info for PUT requests to help diagnose bridge data loss
        if (method.uppercase() == "PUT") {
            val dataLen = data?.length ?: -1
            Log.d("WebDavHttp", "PUT to $urlString (data: ${if (dataLen >= 0) "$dataLen bytes" else "null"})")

            if (data.isNullOrEmpty()) {
                throw IllegalArgumentException(
                    "PUT request received with null/empty body for $urlString. " +
                        "The Capacitor bridge likely dropped the payload."
                )
            }
        }

        // Handle request body
        val requestBody: RequestBody? = when {
            data.isNullOrEmpty() && methodRequiresBody(method) -> {
                // Some WebDAV methods require a body even if empty
                "".toRequestBody()
            }
            !data.isNullOrEmpty() -> {
                val contentType = headers.getString("Content-Type") 
                    ?: headers.getString("content-type") 
                    ?: "application/xml; charset=utf-8"
                data.toRequestBody(contentType.toMediaType())
            }
            else -> null
        }

        // Set method with body
        when (method.uppercase()) {
            "GET" -> requestBuilder.get()
            "POST" -> requestBuilder.post(requestBody ?: "".toRequestBody())
            "PUT" -> requestBuilder.put(requestBody ?: "".toRequestBody())
            "DELETE" -> {
                if (requestBody != null) {
                    requestBuilder.delete(requestBody)
                } else {
                    requestBuilder.delete()
                }
            }
            "HEAD" -> requestBuilder.head()
            "PATCH" -> requestBuilder.patch(requestBody ?: "".toRequestBody())
            "OPTIONS" -> requestBuilder.method("OPTIONS", null)
            // WebDAV methods
            "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "REPORT" -> {
                requestBuilder.method(method.uppercase(), requestBody)
            }
            else -> {
                throw IllegalArgumentException("Unsupported HTTP method: $method")
            }
        }

        val request = requestBuilder.build()

        // Execute request
        client.newCall(request).execute().use { response ->
            // Get response headers
            val responseHeaders = JSObject()
            response.headers.forEach { (name, value) ->
                // Convert header names to lowercase for consistency with web fetch
                responseHeaders.put(name.lowercase(), value)
            }

            // Get response body
            val responseBody = try {
                response.body?.string() ?: ""
            } catch (e: Exception) {
                Log.w("WebDavHttp", "Failed to read response body for $urlString: ${e.message}")
                ""
            }

            // Handle non-success status codes by including error info
            if (!response.isSuccessful) {
                // Log the error for debugging
                Log.d("WebDavHttp", "HTTP ${response.code} for $urlString")
            }

            // Return response matching the expected format
            return JSObject().apply {
                put("data", responseBody)
                put("status", response.code)
                put("headers", responseHeaders)
                put("url", response.request.url.toString())
            }
        }
    }

    private fun methodRequiresBody(method: String): Boolean {
        return when (method.uppercase()) {
            "POST", "PUT", "PATCH", "PROPFIND", "PROPPATCH", "REPORT", "LOCK" -> true
            else -> false
        }
    }

    private fun handleError(call: PluginCall, e: Exception) {
        when (e) {
            is UnknownHostException -> {
                call.reject("Network error: Unable to resolve host", "NETWORK_ERROR", e)
            }
            is SocketTimeoutException -> {
                call.reject("Network error: Request timeout", "TIMEOUT_ERROR", e)
            }
            is SSLHandshakeException -> {
                call.reject("SSL error: ${e.message}", "SSL_ERROR", e)
            }
            is IOException -> {
                call.reject("Network error: ${e.message}", "NETWORK_ERROR", e)
            }
            is IllegalArgumentException -> {
                call.reject(e.message ?: "Invalid argument", "INVALID_ARGUMENT", e)
            }
            else -> {
                call.reject("Unexpected error: ${e.message}", "UNKNOWN_ERROR", e)
            }
        }
    }
}