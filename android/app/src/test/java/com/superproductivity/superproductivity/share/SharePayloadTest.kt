package com.superproductivity.superproductivity.share

import com.superproductivity.superproductivity.widget.ShareIntentQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SharePayloadTest {
    private fun title(text: String, subject: String? = null, title: String? = null): String =
        SharePayload.build(text, subject, title)!!.getString("title")

    @Test
    fun prefersTheSubjectThenTheTitle() {
        assertEquals("Great Article", title("https://example.com/post", "Great Article", "Some Title"))
        assertEquals("Some Title", title("https://example.com/post", "  ", "Some Title"))
    }

    @Test
    fun derivesAReadableTitleFromALink() {
        assertEquals(
            "example.com: some cool article",
            title("https://www.example.com/some-cool-article"),
        )
        assertEquals("example.com", title("https://example.com/"))
        assertEquals("example.com: a b", title("https://Example.com/a/b"))
        assertEquals("example.com: grüße welt", title("https://example.com/gr%C3%BC%C3%9Fe_welt"))
        // Like readable-url.ts: unescaped characters still parse, `+` stays,
        // a malformed escape keeps the whole URL.
        assertEquals("example.com: a|b c+d", title("https://example.com/a|b/c+d?q={x}"))
        assertEquals("https://example.com/%zz", title("https://example.com/%zz"))
    }

    @Test
    fun usesTheFirstLineOfText() {
        assertEquals("Buy milk", title("Buy milk\nand bread"))
        assertEquals("Buy milk", title("  Buy milk  \r\nand bread"))
    }

    @Test
    fun cutsLongTitlesTo150CodePoints() {
        val result = title("p", subject = "x".repeat(300))
        assertEquals(150, result.length)
        assertTrue(result.endsWith("..."))
        // Never splits a surrogate pair.
        val emoji = title("p", subject = "😀".repeat(200))
        assertEquals(150, emoji.codePointCount(0, emoji.length))
    }

    @Test
    fun keepsTheTextAsNotesAndALoneUrlAsLink() {
        val link = SharePayload.build("  https://example.com/a?b=c  ", null, null)!!
        assertEquals("https://example.com/a?b=c", link.getString("notes"))
        assertEquals("https://example.com/a?b=c", link.getString("link"))
        assertEquals(1, link.getInt("v"))
        assertEquals("Android share", link.getString("client"))

        val note = SharePayload.build("Read https://example.com later", null, null)!!
        assertEquals("Read https://example.com later", note.getString("notes"))
        assertFalse(note.has("link"))
    }

    @Test
    fun linkNeedsAnHttpUrlWithAHost() {
        assertNull(SharePayload.toLink("ftp://example.com/x"))
        assertNull(SharePayload.toLink("https://"))
        assertNull(SharePayload.toLink("javascript:alert(1)"))
        assertNull(SharePayload.toLink("https://exa mple.com"))
        assertNull(SharePayload.toLink("https://example.com/" + "a".repeat(2048)))
        assertEquals("HTTPS://example.com", SharePayload.toLink("HTTPS://example.com"))
        // Characters browsers leave unescaped, which java.net.URI rejects.
        for (url in listOf("https://example.com/a|b", "https://example.com/s?q={x}^y", "https://example.com/%zz")) {
            assertEquals(url, SharePayload.toLink(url))
        }
    }

    @Test
    fun blankSharesMakeNoPayload() {
        assertNull(SharePayload.build(null, "Subject", null))
        assertNull(SharePayload.build(" \n ", "Subject", null))
    }

    @Test
    fun onlySharesWithinTheServerNotesLimitUpload() {
        val small = SharePayload.build("a".repeat(8 * 1024), null, null)!!
        val large = SharePayload.build("ä".repeat(4 * 1024 + 1), null, null)!!
        assertTrue(SharePayload.isUploadable(small))
        assertFalse(SharePayload.isUploadable(large))
    }

    @Test
    fun cutsNotesAt100kCodePoints() {
        val payload = SharePayload.build("n".repeat(100_005), null, null)!!
        assertEquals(100_000, payload.getString("notes").length)
    }

    @Test
    fun migratesALegacyShare() {
        val payload = ShareIntentQueue.parseLegacy(
            """{"title":"","subject":"Page","type":"LINK","path":"https://example.com/x"}""",
        )!!
        assertEquals("Page", payload.getString("title"))
        assertEquals("https://example.com/x", payload.getString("link"))
        assertNull(ShareIntentQueue.parseLegacy("""{"path":"  "}"""))
        assertNull(ShareIntentQueue.parseLegacy("{nope"))
    }
}
