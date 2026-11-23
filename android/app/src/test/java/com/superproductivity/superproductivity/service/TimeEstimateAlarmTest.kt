package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimeEstimateAlarmTest {
    private val repeat = TimeEstimateAlarm.REPEAT_INTERVAL_MS

    @Test
    fun `fires when tracked time reaches the estimate`() {
        assertEquals(
            1_000L + 20 * 60_000,
            TimeEstimateAlarm.nextTriggerAtMs(1_000, 10 * 60_000, 30 * 60_000, null)
        )
    }

    @Test
    fun `fires right away when the estimate is already exceeded`() {
        assertEquals(1_000L, TimeEstimateAlarm.nextTriggerAtMs(1_000, 40 * 60_000, 30 * 60_000, null))
    }

    @Test
    fun `a re-arm after a notice waits for the repeat interval`() {
        assertEquals(
            500L + repeat,
            TimeEstimateAlarm.nextTriggerAtMs(1_000, 40 * 60_000, 30 * 60_000, 500)
        )
    }

    @Test
    fun `a raised estimate fires at its own crossing even after a notice`() {
        val now = 1_000L
        assertEquals(
            now + 2 * repeat,
            TimeEstimateAlarm.nextTriggerAtMs(now, 30 * 60_000, 30 * 60_000 + 2 * repeat, now)
        )
    }

    @Test
    fun `isReached tolerates clock jitter but not an early alarm`() {
        assertTrue(TimeEstimateAlarm.isReached(29_999, 30_000))
        assertFalse(TimeEstimateAlarm.isReached(20_000, 30_000))
    }
}
