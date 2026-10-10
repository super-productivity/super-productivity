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
}
