package com.superproductivity.superproductivity.widget

import com.superproductivity.superproductivity.share.SharePayload
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class CaptureInboxTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun inbox() = CaptureInbox(File(tmp.root, "capture-inbox"))

    @Test
    fun readsAreNonDestructiveAndOrderedOldestFirst() {
        val inbox = inbox()
        val second = inbox.add("Second", "overlay", createdAt = 2_000)
        val first = inbox.add("  First  ", "overlay", createdAt = 1_000)

        repeat(2) {
            val pending = JSONArray(inbox.pendingJson())
            assertEquals(2, pending.length())
            assertEquals(first, pending.getJSONObject(0).getString("id"))
            assertEquals("First", pending.getJSONObject(0).getString("title"))
            assertEquals(second, pending.getJSONObject(1).getString("id"))
        }
    }

    @Test
    fun acknowledgeRemovesOnlyThatEntryAndIsIdempotent() {
        val inbox = inbox()
        val a = inbox.add("A", "overlay")
        val b = inbox.add("B", "overlay")

        assertTrue(inbox.acknowledge(a))
        assertTrue(inbox.acknowledge(a))
        val pending = JSONArray(inbox.pendingJson())
        assertEquals(1, pending.length())
        assertEquals(b, pending.getJSONObject(0).getString("id"))
    }

    @Test
    fun rejectsIdsThatAreNotCanonicalUuids() {
        val inbox = inbox()
        inbox.add("A", "overlay")
        assertFalse(inbox.acknowledge("../capture-inbox"))
        assertFalse(inbox.acknowledge("1-1-1-1-1"))
        assertEquals(1, JSONArray(inbox.pendingJson()).length())
    }

    @Test
    fun skipsCorruptAndTemporaryFilesWithoutBlockingValidOnes() {
        val inbox = inbox()
        val valid = inbox.add("Valid", "overlay")
        val dir = File(tmp.root, "capture-inbox")
        File(dir, "0F1B7C9E-3D2A-4B5C-8E6F-7A8B9C0D1E2F.json").writeText("{not json")
        File(dir, "1F1B7C9E-3D2A-4B5C-8E6F-7A8B9C0D1E2F.tmp").writeText("{}")

        val pending = JSONArray(inbox.pendingJson())
        assertEquals(1, pending.length())
        assertEquals(valid, pending.getJSONObject(0).getString("id"))
    }

    @Test
    fun emptyOrMissingInboxReadsAsEmptyArray() {
        assertEquals("[]", inbox().pendingJson())
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsBlankTitle() {
        inbox().add("   ", "overlay")
    }

    @Test
    fun legacyQueueKeepsIdsAndSkipsBlankTitles() {
        val legacy = """
            {"tasks":[
              {"id":"7DCC80FA-577A-4D99-B16E-15D4B8787B62","title":" Buy milk ","createdAt":5},
              {"id":"0F1B7C9E-3D2A-4B5C-8E6F-7A8B9C0D1E2F","title":"  "}
            ]}
        """.trimIndent()

        val tasks = WidgetTaskQueue.parseLegacy(legacy)
        assertEquals(1, tasks.size)
        assertEquals("7DCC80FA-577A-4D99-B16E-15D4B8787B62", tasks[0].id)
        assertEquals("Buy milk", tasks[0].title)
        assertEquals(5L, tasks[0].createdAt)
        assertTrue(WidgetTaskQueue.parseLegacy("{broken").isEmpty())
    }

    @Test
    fun reAddingTheSameIdOverwritesInsteadOfDuplicating() {
        val inbox = inbox()
        val id = "7DCC80FA-577A-4D99-B16E-15D4B8787B62"
        inbox.add("Buy milk", "overlay", 5, id)
        inbox.add("Buy milk", "overlay", 5, id)
        assertEquals(1, JSONArray(inbox.pendingJson()).length())
    }

    @Test
    fun widgetQuickAddIsATrimmedTitleCaptureNotAShare() {
        val inbox = inbox()
        val id = inbox.add("  Call Anna @tomorrow ", CaptureInbox.SOURCE_WIDGET)

        val captures = JSONArray(inbox.pendingJson())
        assertEquals(1, captures.length())
        val entry = captures.getJSONObject(0)
        assertEquals(id, entry.getString("id"))
        assertEquals("Call Anna @tomorrow", entry.getString("title"))
        assertEquals("widget", entry.getString("source"))
        assertEquals(0, JSONArray(inbox.pendingSharesJson()).length())
    }

    private fun share(text: String = "https://example.com/a") =
        SharePayload.build(text, null, null, createdAt = 1)!!

    @Test
    fun keepsSharesOutOfTheTitleCaptureRead() {
        val inbox = inbox()
        val typed = inbox.add("Typed", "overlay", createdAt = 2)
        val shared = inbox.addShare(share(), isUpload = false)

        val captures = JSONArray(inbox.pendingJson())
        assertEquals(1, captures.length())
        assertEquals(typed, captures.getJSONObject(0).getString("id"))

        val shares = JSONArray(inbox.pendingSharesJson())
        assertEquals(1, shares.length())
        val entry = shares.getJSONObject(0)
        assertEquals(shared, entry.getString("id"))
        assertEquals("share", entry.getString("source"))
        assertEquals("https://example.com/a", entry.getString("link"))
        assertEquals("example.com: a", entry.getString("title"))
    }

    @Test
    fun anUploadingShareIsNotImportedUntilReleasedOrTakenOver() {
        val inbox = inbox()
        val id = inbox.addShare(share(), isUpload = true)
        assertEquals(0, JSONArray(inbox.pendingSharesJson()).length())

        inbox.releaseUpload(id)
        assertEquals(1, JSONArray(inbox.pendingSharesJson()).length())
        assertTrue(inbox.beginUpload(id) is CaptureInbox.UploadStart.Done)
    }

    @Test
    fun onlyOneUploadAttemptAtATime() {
        val inbox = inbox()
        val id = inbox.addShare(share(), isUpload = true)

        val first = inbox.beginUpload(id, now = 1_000)
        assertTrue(first is CaptureInbox.UploadStart.Ready)
        assertTrue(inbox.beginUpload(id, now = 2_000) is CaptureInbox.UploadStart.Busy)

        inbox.endUploadAttempt(id)
        assertTrue(inbox.beginUpload(id, now = 3_000) is CaptureInbox.UploadStart.Ready)
        // A killed attempt frees the entry once its lease ran out.
        assertTrue(
            inbox.beginUpload(id, now = 3_000 + CaptureInbox.SEND_LEASE_MS)
                is CaptureInbox.UploadStart.Ready,
        )
    }

    @Test
    fun takeOverSkipsAnAttemptInFlight() {
        val inbox = inbox()
        val idle = inbox.addShare(share("idle"), isUpload = true)
        val sending = inbox.addShare(share("sending"), isUpload = true)
        inbox.beginUpload(sending, now = 10_000)

        assertEquals(listOf(idle), inbox.takeOverUploads(now = 20_000))
        assertEquals(listOf(idle), ids(inbox.pendingSharesJson()))
        assertTrue(inbox.beginUpload(idle) is CaptureInbox.UploadStart.Done)

        // After the lease, the stuck attempt is taken over too.
        assertEquals(listOf(sending), inbox.takeOverUploads(now = 10_000 + CaptureInbox.SEND_LEASE_MS))
        assertEquals(2, JSONArray(inbox.pendingSharesJson()).length())
    }

    @Test
    fun anUploadedShareIsGone() {
        val inbox = inbox()
        val id = inbox.addShare(share(), isUpload = true)
        assertTrue(inbox.beginUpload(id) is CaptureInbox.UploadStart.Ready)
        assertTrue(inbox.acknowledge(id))
        assertTrue(inbox.beginUpload(id) is CaptureInbox.UploadStart.Done)
        assertEquals(emptyList<String>(), inbox.takeOverUploads())
    }

    private fun ids(json: String): List<String> {
        val array = JSONArray(json)
        return (0 until array.length()).map { array.getJSONObject(it).getString("id") }
    }
}
