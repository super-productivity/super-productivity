package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileSyncReminderPlanTest {

    private val now = 1_000L
    private fun r(id: String, at: Long, isDeadline: Boolean = false) = ReminderToSchedule(id, "x", at, isDeadline)
    private fun reminders(vararg r: ReminderToSchedule) = SyncFileReadResult.Reminders(r.toList())

    @Test
    fun `first run schedules future reminders and cancels nothing`() {
        val plan = planReminderSlots(null, reminders(r("a", 2_000), r("b", 500), r("a", 3_000, true)), now)
        assertEquals(emptySet<String>(), plan.reminderIdsToCancel)
        assertEquals(listOf(r("a", 2_000), r("a", 3_000, true)), plan.toSchedule)
        assertEquals(mapOf("a" to 2_000L, "b" to 500L, "a_deadline" to 3_000L), plan.slots)
    }

    @Test
    fun `cancels removed slots and leaves unchanged ones alone`() {
        val plan = planReminderSlots(mapOf("a" to 2_000L, "a_deadline" to 2_500L), reminders(r("a", 2_000)), now)
        assertEquals(setOf("a_deadline"), plan.reminderIdsToCancel)
        assertEquals(emptySet<String>(), plan.taskIdsToCancel)
        assertEquals(emptyList<ReminderToSchedule>(), plan.toSchedule)
    }

    @Test
    fun `a task with no slots left cancels all its alarms, due-day included`() {
        val plan = planReminderSlots(mapOf("a" to 2_000L, "a_deadline" to 2_500L, "b" to 3_000L), reminders(r("b", 3_000)), now)
        assertEquals(setOf("a"), plan.taskIdsToCancel)
        assertEquals(emptySet<String>(), plan.reminderIdsToCancel)
    }

    @Test
    fun `reschedules a moved reminder`() {
        val plan = planReminderSlots(mapOf("a" to 2_000L), reminders(r("a", 5_000)), now)
        assertEquals(emptySet<String>(), plan.reminderIdsToCancel)
        assertEquals(listOf(r("a", 5_000)), plan.toSchedule)
    }

    @Test
    fun `keeps a shown past reminder but cancels one moved into the past`() {
        // "shown" is past and unchanged: dismissing its notification would lose it
        val plan = planReminderSlots(
            mapOf("shown" to 500L, "moved" to 2_000L),
            reminders(r("shown", 500), r("moved", 800)),
            now,
        )
        assertEquals(setOf("moved"), plan.reminderIdsToCancel)
        assertEquals(emptyList<ReminderToSchedule>(), plan.toSchedule)
    }

    @Test
    fun `remembers due-day-only tasks without scheduling them`() {
        val plan = planReminderSlots(null, SyncFileReadResult.Reminders(emptyList(), setOf("d")), now)
        assertEquals(mapOf("d_dueday" to 0L), plan.slots)
        assertEquals(emptyList<ReminderToSchedule>(), plan.toSchedule)
    }

    @Test
    fun `cancels the due-day alarm of a task done elsewhere`() {
        val plan = planReminderSlots(mapOf("d_dueday" to 0L), reminders(), now)
        assertEquals(setOf("d"), plan.taskIdsToCancel)
    }

    @Test
    fun `cancels the due-day alarm once the task gets a reminder time`() {
        val plan = planReminderSlots(mapOf("d_dueday" to 0L), reminders(r("d", 2_000)), now)
        assertEquals(setOf("d_dueday"), plan.reminderIdsToCancel)
        assertEquals(listOf(r("d", 2_000)), plan.toSchedule)
    }

    @Test
    fun `parses stored slots`() {
        assertEquals(mapOf("a" to 5L), parseReminderSlots("""{"a":5}"""))
        assertNull(parseReminderSlots(null))
    }
}
