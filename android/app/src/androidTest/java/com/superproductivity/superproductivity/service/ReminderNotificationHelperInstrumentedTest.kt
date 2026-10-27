package com.superproductivity.superproductivity.service

import android.Manifest
import android.app.Notification
import android.content.Context
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.BuildConfig
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
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
 * Run: ./gradlew :app:connectedFdroidDebugAndroidTest (emulator/device required).
 * Only fdroid declares USE_FULL_SCREEN_INTENT; CI runs the play flavor, where the
 * full-screen intent assertions are skipped.
 */
@RunWith(AndroidJUnit4::class)
class ReminderNotificationHelperInstrumentedTest {

    private val context: Context by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
    }

    private val alarmNotificationId = 900_001
    private val regularNotificationId = 900_002

    @Before
    fun setUp() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
    }

    @After
    fun cleanUp() {
        val nm = NotificationManagerCompat.from(context)
        nm.cancel(alarmNotificationId)
        nm.cancel(regularNotificationId)
        nm.cancel(ReminderNotificationHelper.SUMMARY_NOTIFICATION_ID)
    }

    // notify() is enqueued asynchronously by the system, so poll like the
    // sibling reminder tests instead of reading the active list once.
    private fun postedNotification(id: Int): Notification? {
        val deadline = SystemClock.elapsedRealtime() + 5_000
        while (true) {
            val posted = NotificationManagerCompat.from(context).activeNotifications
                .firstOrNull { it.id == id }?.notification
            if (posted != null || SystemClock.elapsedRealtime() >= deadline) return posted
            SystemClock.sleep(100)
        }
    }

    @Test
    fun alarmStyleReminderCarriesFullScreenIntent() {
        ReminderNotificationHelper.showNotification(
            context, alarmNotificationId, "reminder-instr-1", "task-instr-1",
            "Test alarm reminder", "TASK", useAlarmStyle = true, isOngoing = false
        )

        val notification = postedNotification(alarmNotificationId)
        assertNotNull("alarm-style reminder was not posted", notification)
        // Full content plus Done/Snooze actions must be usable on the lock screen,
        // where this notification now appears.
        assertEquals(Notification.VISIBILITY_PUBLIC, notification!!.visibility)
        assertEquals(Notification.CATEGORY_ALARM, notification.category)
        // Only fdroid declares USE_FULL_SCREEN_INTENT; without it the system may
        // drop the intent, so the remaining checks only hold for fdroid.
        if (BuildConfig.FLAVOR != "fdroid") return
        assertNotNull(
            "alarm-style reminders must carry a full-screen intent so Android wakes " +
                "the screen and presents the reminder when it is off (#10071)",
            notification.fullScreenIntent
        )
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
