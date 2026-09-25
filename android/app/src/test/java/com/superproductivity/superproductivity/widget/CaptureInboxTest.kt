package com.superproductivity.superproductivity.widget

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
}
