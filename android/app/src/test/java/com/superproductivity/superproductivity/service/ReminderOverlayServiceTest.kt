package com.superproductivity.superproductivity.service

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderOverlayServiceTest {

    @Test
    fun supportsTaskAndDateRelatedReminderTypes() {
        assertTrue(ReminderOverlayService.supportsReminderType("TASK"))
        assertTrue(ReminderOverlayService.supportsReminderType("DUE_DATE"))
        assertTrue(ReminderOverlayService.supportsReminderType("DEADLINE"))
    }

    @Test
    fun doesNotOverlayUnrelatedNotificationTypes() {
        assertFalse(ReminderOverlayService.supportsReminderType("BREAK"))
        assertFalse(ReminderOverlayService.supportsReminderType("TRACKING"))
        assertFalse(ReminderOverlayService.supportsReminderType("UNKNOWN"))
    }
}
