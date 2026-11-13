package com.superproductivity.superproductivity.app

import com.superproductivity.superproductivity.app.LaunchUrlReplayGuard.BaseUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchUrlReplayGuardTest {
    private val createTask = "com.super-productivity.app://create-task?title=dup-test"
    private val installedAt = 1_000L

    /** Feeds fresh activity launches through the guard, carrying its stored state. */
    private class Device(private val packageUpdatedAtMs: () -> Long) {
        private var stored: BaseUrl? = null

        /** [taskId] stays the same when the system relaunches an existing task. */
        fun freshLaunch(uri: String?, nowMs: Long, taskId: Int = 7): Boolean {
            val launch = LaunchUrlReplayGuard.baseUrlOf(uri, taskId, nowMs)
            val replay = LaunchUrlReplayGuard.isReplay(stored, launch, packageUpdatedAtMs())
            stored = launch
            return !replay
        }
    }

    @Test
    fun `system relaunch after a package update does not dispatch the base url again`() {
        // #11153: tile cold-starts the app at 22:45, Play updates it at 23:28 and
        // the system relaunches the task with its base VIEW intent.
        var updatedAt = installedAt
        val device = Device { updatedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L))
        updatedAt = 5_000L
        assertFalse(device.freshLaunch(createTask, nowMs = 5_100L))
    }

    @Test
    fun `a second package update relaunching the same base intent is still dropped`() {
        var updatedAt = installedAt
        val device = Device { updatedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L))
        updatedAt = 5_000L
        assertFalse(device.freshLaunch(createTask, nowMs = 5_100L))
        updatedAt = 9_000L
        assertFalse(device.freshLaunch(createTask, nowMs = 9_100L))
    }

    @Test
    fun `a same-url launch after a dropped replay dispatches again`() {
        // Constant URLs (launcher shortcuts, a fixed-title tile) must keep working
        // after the one replay is dropped.
        var updatedAt = installedAt
        val device = Device { updatedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L))
        updatedAt = 5_000L
        assertFalse(device.freshLaunch(createTask, nowMs = 5_100L))
        assertTrue(device.freshLaunch(createTask, nowMs = 7_000L))
        assertTrue(device.freshLaunch(createTask, nowMs = 8_000L))
    }

    @Test
    fun `a same-url tap in a new task after an update dispatches`() {
        // Swiped away from Recents, Play auto-updates, then the user taps the
        // tile again: a new task, not a relaunch of the old one.
        var updatedAt = installedAt
        val device = Device { updatedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L, taskId = 7))
        updatedAt = 5_000L
        assertTrue(device.freshLaunch(createTask, nowMs = 6_000L, taskId = 8))
    }

    @Test
    fun `repeated cold launches with the same url dispatch each time without an update`() {
        // A quick-add tile tapped again after the process died must add a task again.
        val device = Device { installedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L))
        assertTrue(device.freshLaunch(createTask, nowMs = 3_000L))
        assertTrue(device.freshLaunch(createTask, nowMs = 4_000L))
    }

    @Test
    fun `a different url after an update is dispatched`() {
        var updatedAt = installedAt
        val device = Device { updatedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L))
        updatedAt = 5_000L
        assertTrue(device.freshLaunch("$createTask-2", nowMs = 6_000L))
    }

    @Test
    fun `a launch without a url forgets the base url`() {
        // A launcher start becomes the new task's base intent, so a later
        // relaunch can no longer replay the earlier url.
        var updatedAt = installedAt
        val device = Device { updatedAt }

        assertTrue(device.freshLaunch(createTask, nowMs = 2_000L))
        assertTrue(device.freshLaunch(null, nowMs = 3_000L))
        updatedAt = 5_000L
        assertTrue(device.freshLaunch(createTask, nowMs = 6_000L))
    }

    @Test
    fun `stores a hash of the url, not the url itself`() {
        assertEquals(
            BaseUrl(createTask.hashCode(), 7, 2_000L),
            LaunchUrlReplayGuard.baseUrlOf(createTask, 7, 2_000L),
        )
    }
}
