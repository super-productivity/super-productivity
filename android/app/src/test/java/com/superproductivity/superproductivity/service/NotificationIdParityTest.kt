package com.superproductivity.superproductivity.service

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The frontend (android-notification-id.util.ts) and native sync derive alarm ids
 * independently; a mismatch would leave two alarms per reminder (one per side).
 * Expected values come from the TS generateNotificationId() for the same strings.
 */
class NotificationIdParityTest {

    @Test
    fun `task and deadline ids match the frontend`() {
        assertEquals(1720157511, SuperSyncBackgroundProvider.generateNotificationId("instr-deadline-task"))
        assertEquals(
            971870494,
            SuperSyncBackgroundProvider.generateNotificationId("instr-deadline-task_deadline"),
        )
    }
}
