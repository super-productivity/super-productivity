package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Test

class FocusTaskClockTest {
    @Test
    fun `accrues task time independently of the focus countdown`() {
        val clock = FocusTaskClock()
        clock.update("task-1", 5_000, 1_000)

        assertEquals(FocusTaskClock.Snapshot("task-1", 8_000, true), clock.snapshot(4_000))
    }

    @Test
    fun `focus pause freezes a running task and resume continues it`() {
        val clock = FocusTaskClock()
        clock.update("task-1", 5_000, 1_000)
        clock.setFocusPaused(true, 4_000)

        assertEquals(FocusTaskClock.Snapshot("task-1", 8_000, false), clock.snapshot(10_000))

        clock.setFocusPaused(false, 10_000)
        assertEquals(FocusTaskClock.Snapshot("task-1", 10_000, true), clock.snapshot(12_000))
    }

    @Test
    fun `resume does not restart a task that stopped before focus pause`() {
        val clock = FocusTaskClock()
        clock.update("task-1", 5_000, 1_000)
        // The JS selector has no current task and therefore sends 0; the
        // native clock must retain the actual total it already accrued.
        clock.update(null, 0, 3_000)
        clock.setFocusPaused(true, 4_000)
        clock.setFocusPaused(false, 10_000)

        assertEquals(FocusTaskClock.Snapshot("task-1", 7_000, false), clock.snapshot(12_000))
    }

    @Test
    fun `paused task setup after clear retains its total until task tracking resumes`() {
        val clock = FocusTaskClock()
        clock.update("old-task", 3_000, 1_000)
        clock.clear()
        clock.update("paused-task", 8_000, 4_000, isTracking = false)

        assertEquals(FocusTaskClock.Snapshot("paused-task", 8_000, false), clock.snapshot(10_000))
        clock.setFocusPaused(true, 10_000)
        clock.setFocusPaused(false, 20_000)
        assertEquals(FocusTaskClock.Snapshot("paused-task", 8_000, false), clock.snapshot(25_000))

        clock.update("paused-task", 8_000, 25_000, isTracking = true)
        assertEquals(FocusTaskClock.Snapshot("paused-task", 10_000, true), clock.snapshot(27_000))
    }

    @Test
    fun `task switches and time edits reanchor the total`() {
        val clock = FocusTaskClock()
        clock.update("task-1", 5_000, 1_000)
        clock.update("task-2", 20_000, 4_000)
        assertEquals(FocusTaskClock.Snapshot("task-2", 21_000, true), clock.snapshot(5_000))

        clock.update("task-2", 12_000, 5_000)
        assertEquals(FocusTaskClock.Snapshot("task-2", 14_000, true), clock.snapshot(7_000))
    }

    @Test
    fun `remote delta preserves uncredited native elapsed time`() {
        val hour = 3_600_000L
        val clock = FocusTaskClock()
        clock.update("task-1", hour, 1_000)
        assertEquals(3 * hour, clock.snapshot(1_000 + 2 * hour).timeSpentMs)

        clock.adjust("task-1", hour)
        assertEquals(4 * hour, clock.snapshot(1_000 + 2 * hour).timeSpentMs)
        assertEquals(4 * hour + 5_000, clock.snapshot(6_000 + 2 * hour).timeSpentMs)
    }

    @Test
    fun `remote delta for an old task does not change the current task`() {
        val clock = FocusTaskClock()
        clock.update("task-1", 5_000, 1_000)
        clock.update("task-2", 20_000, 4_000)

        clock.adjust("task-1", 10_000)
        assertEquals(FocusTaskClock.Snapshot("task-2", 21_000, true), clock.snapshot(5_000))
        clock.adjust("task-2", -25_000)
        assertEquals(FocusTaskClock.Snapshot("task-2", 1_000, true), clock.snapshot(5_000))
    }

    @Test
    fun `clear drops task association when focus ends`() {
        val clock = FocusTaskClock()
        clock.update("task-1", 5_000, 1_000)
        clock.clear()

        assertEquals(FocusTaskClock.Snapshot(null, 0, false), clock.snapshot(10_000))
    }
}
