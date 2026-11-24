package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The app's snapshot (getRepeatCfgSnapshotForNative) replaces the cache. */
class RepeatReminderCacheTest {

    @Test
    fun `an app snapshot yields complete armable configs and archived ids`() {
        val state = RepeatReminderCache.parseAppSnapshot(
            """{"cfgs":[{"id":"cfg","title":"Standup","projectId":"p1","tagIds":["t1"],
            "repeatCycle":"DAILY","repeatEvery":1,"startDate":"2026-01-01",
            "startTime":"09:00","remindAt":"AtStart","isPaused":false}],
            "archivedProjectIds":["p9"]}""",
        )!!
        val cfg = state.byId("cfg")!!
        assertTrue(cfg.isComplete)
        assertTrue(cfg.isArmable())
        assertEquals(listOf("t1"), cfg.tagIds)
        assertEquals(setOf("p9"), state.archivedProjectIds)
    }

    @Test
    fun `malformed snapshots keep the cache`() {
        assertNull(RepeatReminderCache.parseAppSnapshot("not json"))
        assertNull(RepeatReminderCache.parseAppSnapshot("""{"archivedProjectIds":[]}"""))
    }
}
