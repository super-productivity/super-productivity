package com.superproductivity.superproductivity.share

import org.json.JSONObject
import java.net.URI

/**
 * Turns an Android text share into a v1 capture payload, the shape the
 * SuperSync capture queue seals (`CapturePayload` in
 * packages/super-sync-server/src/capture/capture-queue.store.ts). The same
 * payload is stored in the local CaptureInbox and, when capture is on, sealed
 * and uploaded, so both paths create the same task.
 *
 * The title is fixed here rather than in the app: released apps import a
 * capture's title as is.
 */
object SharePayload {
    const val CLIENT = "Android share"
    const val TITLE_MAX_CHARS = 150

    /** As for iOS shares; longer text is cut. */
    const val NOTES_MAX_CHARS = 100_000

    /** The server's notes limit; a longer share stays on this device. */
    const val UPLOAD_NOTES_MAX_BYTES = 8 * 1024
    private const val LINK_MAX_CHARS = 2048

    /** @return null for a blank share, which would only make a useless task. */
    fun build(
        text: String?,
        subject: String?,
        title: String?,
        createdAt: Long = System.currentTimeMillis(),
    ): JSONObject? {
        val trimmed = text?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val link = toLink(trimmed)
        return JSONObject()
            .put("v", 1)
            .put("title", buildTitle(trimmed, link, subject, title))
            .put("notes", cutCodePoints(trimmed, NOTES_MAX_CHARS))
            .apply { if (link != null) put("link", link) }
            .put("createdAt", createdAt)
            .put("client", CLIENT)
    }

    fun isUploadable(payload: JSONObject): Boolean =
        payload.optString("notes").toByteArray(Charsets.UTF_8).size <= UPLOAD_NOTES_MAX_BYTES

    /**
     * Port of `buildTaskTitle` (formerly android.effects.ts): the page subject
     * (EXTRA_SUBJECT, sent by browsers), then EXTRA_TITLE, then a readable
     * form of a link or the first line of the text.
     */
    internal fun buildTitle(text: String, link: String?, subject: String?, title: String?): String {
        val chosen = subject?.trim()?.takeIf { it.isNotEmpty() }
            ?: title?.trim()?.takeIf { it.isNotEmpty() }
            ?: if (link != null) readableUrl(link) else text.lineSequence().first().trim()
        val nonBlank = chosen.ifEmpty { "Shared note" }
        return if (nonBlank.codePointCount(0, nonBlank.length) > TITLE_MAX_CHARS) {
            cutCodePoints(nonBlank, TITLE_MAX_CHARS - 3) + "..."
        } else {
            nonBlank
        }
    }

    /** The text when it is exactly one http(s) URL with a host. */
    internal fun toLink(text: String): String? {
        if (text.length > LINK_MAX_CHARS || text.any { it.isWhitespace() }) return null
        if (!text.startsWith("http://", ignoreCase = true) &&
            !text.startsWith("https://", ignoreCase = true)
        ) {
            return null
        }
        return try {
            if (URI(text).host.isNullOrEmpty()) null else text
        } catch (e: Exception) {
            null
        }
    }

    /** Port of src/app/util/readable-url.ts: `host: path words`, or the URL. */
    internal fun readableUrl(url: String): String = try {
        val uri = URI(url)
        val host = uri.host?.lowercase()?.removePrefix("www.")
        if (host.isNullOrEmpty()) {
            url
        } else {
            val words = (uri.path ?: "").removeSuffix("/")
                .replace(Regex("[/_-]"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
            if (words.isEmpty()) host else "$host: $words"
        }
    } catch (e: Exception) {
        url
    }

    /** Cuts by code points, so a surrogate pair is never split. */
    internal fun cutCodePoints(text: String, max: Int): String =
        if (text.codePointCount(0, text.length) <= max) {
            text
        } else {
            text.substring(0, text.offsetByCodePoints(0, max))
        }
}
