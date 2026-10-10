package com.superproductivity.superproductivity.service

import android.content.Context
import androidx.test.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.receiver.NotificationActionReceiver
import com.superproductivity.superproductivity.widget.NotificationActionQueue
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A tracking notification Pause/Done tap (#10683) against the persisted
 * session (#7390): the tap must find a session that only survives on disk, and
 * must leave nothing behind that a later restore could credit a second time.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class TrackingNotificationActionInstrumentedTest {

    private val context: Context
        get() = InstrumentationRegistry.getTargetContext().applicationContext

    @Before
    fun reset() = wipe()

    @After
    fun cleanUp() = wipe()

    private fun wipe() {
        TrackingForegroundService.clearState(context)
        NotificationActionQueue.getAndClearTracking(context)
    }

    private fun session(taskId: String) = TrackingState(
        taskId,
        "Title",
        System.currentTimeMillis() - 60_000,
        5_000,
        TrackingStateStore.currentBootCount(context)
    )

    private fun queuedTrackingActions(): JSONArray =
        JSONArray(NotificationActionQueue.getAndClearTracking(context) ?: "[]")

    @Test
    fun pauseOnALiveSessionClearsItInMemoryAndOnDisk() {
        TrackingForegroundService.setState(context, session("task-1"))

        NotificationActionReceiver.handle(context, TrackingForegroundService.ACTION_PAUSE)

        val queued = queuedTrackingActions()
        assertEquals(1, queued.length())
        assertEquals("task-1", queued.getJSONObject(0).getString("taskId"))
        // Nothing left that getTrackingElapsed() could restore and credit again.
        assertNull(TrackingForegroundService.snapshotForBridge(context))
        assertNull(TrackingStateStore.load(context))
    }

    @Test
    fun pauseAfterAProcessKillUsesThePersistedSession() {
        // Fresh process: the companion is empty, the session is only on disk.
        TrackingStateStore.save(context, session("task-1"))

        NotificationActionReceiver.handle(context, TrackingForegroundService.ACTION_DONE)

        val queued = queuedTrackingActions()
        assertEquals(1, queued.length())
        val entry = queued.getJSONObject(0)
        assertEquals(NotificationActionQueue.TRACKING_DONE, entry.getString("type"))
        assertEquals("task-1", entry.getString("taskId"))
        // No exit record for this live pid: only the anchored total is kept.
        val elapsedMs = entry.getLong("elapsedMs")
        assertTrue("elapsedMs=$elapsedMs", elapsedMs in 5_000L..15_000L)
        assertNull(TrackingStateStore.load(context))
    }

    @Test
    fun aSecondTapQueuesNothing() {
        TrackingForegroundService.setState(context, session("task-1"))

        NotificationActionReceiver.handle(context, TrackingForegroundService.ACTION_PAUSE)
        NotificationActionReceiver.handle(context, TrackingForegroundService.ACTION_PAUSE)

        assertEquals(1, queuedTrackingActions().length())
    }
}
