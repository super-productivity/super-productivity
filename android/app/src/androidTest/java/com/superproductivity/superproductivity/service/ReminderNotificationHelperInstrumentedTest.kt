package com.superproductivity.superproductivity.service

import android.Manifest
import android.app.Notification
import androidx.test.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.test.runner.AndroidJUnit4
import androidx.core.app.NotificationManagerCompat
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented test for the full-screen-intent wiring of reminder notifications
 * (#10071): a plain high-priority notification never wakes the screen or shows
 * over the lock screen, so with the screen off the user only hears the sound and
 * later finds the notification buried in the drawer. Only
 * [Notification.fullScreenIntent] changes that — so the regression it guards is
 * exactly "alarm-style reminder posted without a full-screen intent".
 *
 * MUST run on an emulator/device, not Robolectric: the assertion reads back the
 * posted notification from [NotificationManagerCompat.getActiveNotifications],
 * which only reflects real system notification handling (channels, permission
 * gating, PendingIntent resolution).
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class ReminderNotificationHelperInstrumentedTest {

    @get:Rule
    val grantNotifications: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)

    private val context = InstrumentationRegistry.getTargetContext()

    private val alarmNotificationId = 900_001
    private val regularNotificationId = 900_002

    @After
    fun cleanUp() {
        val nm = NotificationManagerCompat.from(context)
        nm.cancel(alarmNotificationId)
        nm.cancel(regularNotificationId)
        nm.cancel(ReminderNotificationHelper.SUMMARY_NOTIFICATION_ID)
    }

    private fun postedNotification(id: Int): Notification? =
        NotificationManagerCompat.from(context).activeNotifications
            .firstOrNull { it.id == id }?.notification

    @Test
    fun alarmStyleReminderCarriesFullScreenIntent() {
        ReminderNotificationHelper.showNotification(
            context, alarmNotificationId, "reminder-instr-1", "task-instr-1",
            "Test alarm reminder", "TASK", useAlarmStyle = true, isOngoing = false
        )

        val notification = postedNotification(alarmNotificationId)
        assertNotNull("alarm-style reminder was not posted", notification)
        assertNotNull(
            "alarm-style reminders must carry a full-screen intent so Android wakes " +
                "the screen and presents the reminder when it is off (#10071)",
            notification!!.fullScreenIntent
        )
        // Full content plus Done/Snooze actions must be usable on the lock screen,
        // where this notification now appears.
        assertEquals(Notification.VISIBILITY_PUBLIC, notification.visibility)
        assertEquals(Notification.CATEGORY_ALARM, notification.category)
        // FSI and tap content intent share the request code; an equal intent filter
        // would silently merge them into one PendingIntent (extras are not part of
        // PendingIntent identity) and strip the tap intent's REMINDER_TASK_ID.
        assertNotEquals(notification.contentIntent, notification.fullScreenIntent)
    }

    @Test
    fun regularReminderStaysWithoutFullScreenIntent() {
        ReminderNotificationHelper.showNotification(
            context, regularNotificationId, "reminder-instr-2", "task-instr-2",
            "Test regular reminder", "TASK", useAlarmStyle = false, isOngoing = false
        )

        val notification = postedNotification(regularNotificationId)
        assertNotNull("regular reminder was not posted", notification)
        // Regular reminders stay calm by default — no screen takeover (#10071).
        assertNull(notification!!.fullScreenIntent)
        assertNotEquals(Notification.VISIBILITY_PUBLIC, notification.visibility)
        assertEquals(Notification.CATEGORY_REMINDER, notification.category)
    }
}
