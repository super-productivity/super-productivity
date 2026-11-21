package com.superproductivity.superproductivity.receiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackedTaskReminderTest {
    @Test
    fun `drops the reminder of the task being tracked`() {
        assertTrue(isReminderForTrackedTask("TASK", "task-1", "task-1"))
    }

    @Test
    fun `rings when nothing is tracked`() {
        assertFalse(isReminderForTrackedTask("TASK", "task-1", null))
        assertFalse(isReminderForTrackedTask("DEADLINE", "task-1", null))
    }

    @Test
    fun `rings when another task is tracked`() {
        assertFalse(isReminderForTrackedTask("TASK", "task-1", "task-2"))
        assertFalse(isReminderForTrackedTask("DEADLINE", "task-1", "task-2"))
    }

    @Test
    fun `drops the deadline reminder of the task being tracked`() {
        assertTrue(isReminderForTrackedTask("DEADLINE", "task-1", "task-1"))
    }

    @Test
    fun `due-date reminders of the tracked task still ring`() {
        assertFalse(isReminderForTrackedTask("DUE_DATE", "task-1", "task-1"))
    }
}
