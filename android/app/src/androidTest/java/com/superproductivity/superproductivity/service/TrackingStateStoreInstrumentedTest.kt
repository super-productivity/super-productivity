package com.superproductivity.superproductivity.service

import android.content.Context
import androidx.test.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented test for the [TrackingStateStore] restore wiring in
 * [TrackingForegroundService] (#7390).
 *
 * Needs a device: the store reads real SharedPreferences, the boot count and
 * the process exit history. A process kill leaves an empty companion and the
 * session on disk; saving straight to the store while the companion is idle
 * reproduces exactly that state. The test process's own pid has not exited,
 * so no exit record matches and only the anchored total is restored.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class TrackingStateStoreInstrumentedTest {

    private val context: Context
        get() = InstrumentationRegistry.getTargetContext().applicationContext

    @Before
    fun reset() = TrackingForegroundService.clearState(context)

    @After
    fun cleanUp() = TrackingForegroundService.clearState(context)

    private fun session(taskId: String, accumulatedMs: Long, bootCount: Int) =
        TrackingState(taskId, "Title", System.currentTimeMillis() - 60_000, accumulatedMs, bootCount)

    @Test
    fun restoresAPersistedSessionIntoAnIdleCompanion() {
        val bootCount = TrackingStateStore.currentBootCount(context)
        TrackingStateStore.save(context, session("task-1", 5_000, bootCount))

        val snapshot = TrackingForegroundService.snapshotForBridge(context)

        assertNotNull(snapshot)
        assertEquals("task-1", snapshot!!.taskId)
        // Frozen at the anchored total: the minute since the anchor is not
        // credited without an exit record.
        assertTrue("elapsed=${snapshot.elapsedMs}", snapshot.elapsedMs in 5_000L..15_000L)
        // The writing process (this one) has no exit record, so it resumes.
        assertTrue(snapshot.resume)
        // Re-anchored on disk, so a second kill counts from the restore.
        val persisted = TrackingStateStore.load(context)
        assertEquals(5_000L, persisted!!.accumulatedMs)
        assertTrue(persisted.startTimestamp > System.currentTimeMillis() - 30_000)
    }

    @Test
    fun aLiveSessionIsNeverReplacedFromDisk() {
        val bootCount = TrackingStateStore.currentBootCount(context)
        TrackingForegroundService.setState(context, session("live", 1_000, bootCount))
        TrackingStateStore.save(context, session("stale", 99_000, bootCount))

        assertEquals("live", TrackingForegroundService.snapshotForBridge(context)!!.taskId)
    }

    @Test
    fun clearStateRemovesThePersistedSession() {
        val bootCount = TrackingStateStore.currentBootCount(context)
        TrackingForegroundService.setState(context, session("task-1", 1_000, bootCount))

        TrackingForegroundService.clearState(context)

        assertNull(TrackingStateStore.load(context))
        assertNull(TrackingForegroundService.snapshotForBridge(context))
    }

    @Test
    fun dropsASessionFromAnEarlierBoot() {
        val bootCount = TrackingStateStore.currentBootCount(context)
        TrackingStateStore.save(context, session("task-1", 5_000, bootCount - 1))

        assertNull(TrackingForegroundService.snapshotForBridge(context))
        assertNull(TrackingStateStore.load(context))
    }
}
