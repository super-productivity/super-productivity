package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileSyncReminderPlanTest {

    private val now = 1_000L
    private fun r(id: String, at: Long, isDeadline: Boolean = false) = ReminderToSchedule(id, "x", at, isDeadline)

    @Test
    fun `first run schedules future reminders and cancels nothing`() {
        val plan = planReminderSlots(null, listOf(r("a", 2_000), r("b", 500), r("a", 3_000, true)), now)
        assertEquals(emptySet<String>(), plan.reminderIdsToCancel)
        assertEquals(listOf(r("a", 2_000), r("a", 3_000, true)), plan.toSchedule)
        assertEquals(mapOf("a" to 2_000L, "b" to 500L, "a_deadline" to 3_000L), plan.slots)
    }

    @Test
    fun `cancels removed slots and leaves unchanged ones alone`() {
        val plan = planReminderSlots(mapOf("a" to 2_000L, "gone_deadline" to 2_500L), listOf(r("a", 2_000)), now)
        assertEquals(setOf("gone_deadline"), plan.reminderIdsToCancel)
        assertEquals(emptyList<ReminderToSchedule>(), plan.toSchedule)
    }

    @Test
    fun `reschedules a moved reminder`() {
        val plan = planReminderSlots(mapOf("a" to 2_000L), listOf(r("a", 5_000)), now)
        assertEquals(emptySet<String>(), plan.reminderIdsToCancel)
        assertEquals(listOf(r("a", 5_000)), plan.toSchedule)
    }

    @Test
    fun `keeps a shown past reminder but cancels one moved into the past`() {
        // "shown" is past and unchanged: dismissing its notification would lose it
        val plan = planReminderSlots(
            mapOf("shown" to 500L, "moved" to 2_000L),
            listOf(r("shown", 500), r("moved", 800)),
            now,
        )
        assertEquals(setOf("moved"), plan.reminderIdsToCancel)
        assertEquals(emptyList<ReminderToSchedule>(), plan.toSchedule)
    }

    @Test
    fun `parses stored slots`() {
        assertEquals(mapOf("a" to 5L), parseReminderSlots("""{"a":5}"""))
        assertNull(parseReminderSlots(null))
    }
}
