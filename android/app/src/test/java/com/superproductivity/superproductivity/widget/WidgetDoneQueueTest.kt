package com.superproductivity.superproductivity.widget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WidgetDoneQueueTest {

    @Test
    fun acknowledgedEntriesAreRemoved() {
        val remaining = WidgetDoneQueue.withoutAcknowledged(
            """{"a":true,"b":false,"c":true}""",
            """{"a":true,"b":false}""",
        )
        assertEquals("""{"c":true}""", JSONObject(remaining!!).toString())
    }

    @Test
    fun nothingRemainsWhenEveryEntryIsAcknowledged() {
        assertNull(WidgetDoneQueue.withoutAcknowledged("""{"a":true}""", """{"a":true}"""))
    }

    // Tapped done, read by Angular, tapped back to undone before the acknowledge:
    // the second tap is not yet applied and must stay queued.
    @Test
    fun entryTappedToAnotherTargetSinceTheReadStays() {
        val remaining = WidgetDoneQueue.withoutAcknowledged("""{"a":false}""", """{"a":true}""")
        assertEquals("""{"a":false}""", JSONObject(remaining!!).toString())
    }

    @Test
    fun acknowledgingAnUnknownTaskChangesNothing() {
        val remaining = WidgetDoneQueue.withoutAcknowledged("""{"a":true}""", """{"gone":true}""")
        assertEquals("""{"a":true}""", JSONObject(remaining!!).toString())
    }

    @Test
    fun unreadableAcknowledgementRemovesNothing() {
        assertEquals(
            """{"a":true}""",
            WidgetDoneQueue.withoutAcknowledged("""{"a":true}""", "not json"),
        )
    }
}
