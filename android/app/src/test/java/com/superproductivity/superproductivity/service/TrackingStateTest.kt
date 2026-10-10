package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackingStateTest {
    @Test
    fun `restores a session persisted in the same boot`() {
        assertEquals(
            TrackingState("task-1", "Title", 1_000, 5_000, 7),
            TrackingState.fromPersisted("task-1", "Title", 1_000, 5_000, 7, 7)
        )
    }

    @Test
    fun `missing title still restores the session`() {
        assertEquals(
            TrackingState("task-1", "", 1_000, 0, 7),
            TrackingState.fromPersisted("task-1", null, 1_000, 0, 7, 7)
        )
    }

    @Test
    fun `drops a session from an earlier boot`() {
        // The device was off for an unknown part of the gap.
        assertNull(TrackingState.fromPersisted("task-1", "Title", 1_000, 5_000, 7, 8))
    }

    @Test
    fun `drops the session when the boot count is unknown`() {
        val unknown = TrackingState.UNKNOWN_BOOT_COUNT
        assertNull(TrackingState.fromPersisted("task-1", "Title", 1_000, 5_000, unknown, unknown))
    }

    @Test
    fun `drops empty or malformed sessions`() {
        assertNull(TrackingState.fromPersisted(null, null, 0, -1, 7, 7))
        assertNull(TrackingState.fromPersisted("", "Title", 1_000, 5_000, 7, 7))
        assertNull(TrackingState.fromPersisted("task-1", "Title", 0, 5_000, 7, 7))
        assertNull(TrackingState.fromPersisted("task-1", "Title", 1_000, -1, 7, 7))
    }

    private val session = TrackingState("task-1", "Title", 1_000, 5_000, 7)

    @Test
    fun `freezes the total at the process exit and resumes counting from now`() {
        assertEquals(
            TrackingState("task-1", "Title", 50_000, 5_000 + 9_000, 7),
            session.frozenAtExit(exitTimestamp = 10_000, nowMs = 50_000)
        )
    }

    @Test
    fun `keeps only the anchored total when the exit time is unknown`() {
        assertEquals(
            TrackingState("task-1", "Title", 50_000, 5_000, 7),
            session.frozenAtExit(exitTimestamp = null, nowMs = 50_000)
        )
    }

    @Test
    fun `ignores an exit recorded before the anchor`() {
        assertEquals(5_000L, session.frozenAtExit(exitTimestamp = 500, nowMs = 50_000).accumulatedMs)
    }

    @Test
    fun `never credits past now when the clock moved back`() {
        assertEquals(
            7_000L,
            session.frozenAtExit(exitTimestamp = 10_000, nowMs = 3_000).accumulatedMs
        )
    }

    @Test
    fun `picks the first exit at or after the anchor`() {
        // Newest first, as the system returns them; 900 is an older process.
        assertEquals(
            4_000L,
            TrackingState.pickExitTimestamp(listOf(20_000L, 4_000L, 900L), 1_000)
        )
        assertNull(TrackingState.pickExitTimestamp(listOf(900L), 1_000))
        assertNull(TrackingState.pickExitTimestamp(emptyList(), 1_000))
    }
}
