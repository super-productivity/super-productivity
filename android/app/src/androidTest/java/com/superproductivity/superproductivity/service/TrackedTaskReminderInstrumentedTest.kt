package com.superproductivity.superproductivity.service

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.receiver.NotificationActionReceiver
import com.superproductivity.superproductivity.receiver.ReminderAlarmReceiver
import com.superproductivity.superproductivity.widget.NotificationActionQueue
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * #6823: a task's reminder is dropped while its timer runs in
 * TrackingForegroundService, which keeps tracking after the app is swiped away.
 * Pausing from the tracking notification runs no JS, so the alarm must still be
 * armed afterwards and ring. The frontend's overdue handling is not exercised.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class TrackedTaskReminderInstrumentedTest {

    private val context: Context by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
    }
    private val taskId = "instr-tracked-task"
    private val notificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId)
    private val remindAt = System.currentTimeMillis() + 60 * 60_000L

    @Before
    fun setUp() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        cleanUp()
        scheduleReminderFromSync(
            context, ReminderToSchedule(taskId, "Task", remindAt, false), useAlarmStyle = false
        )
        assertNotNull("alarm should be stored", storedAlarm())
    }

    @After
    fun cleanUp() {
        TrackingForegroundService.clearState(context)
        NotificationActionQueue.getAndClearTracking(context)
        ReminderNotificationHelper.cancelReminder(context, notificationId)
        NotificationManagerCompat.from(context)
            .cancel(ReminderNotificationHelper.SUMMARY_NOTIFICATION_ID)
    }

    @Test
    fun reminderOfTheTrackedTaskIsDropped() {
        TrackingForegroundService.setState(context, session())

        fireAlarm()

        // Dropping cancels the stored alarm; wait for that, then nothing is shown.
        assertNotNull("alarm should be dropped", waitFor(5_000) { (storedAlarm() == null).takeIf { it } })
        assertNull("tracked task's reminder must not show", activeNotification())
    }

    @Test
    fun reminderRingsAfterPausingFromTheTrackingNotification() {
        TrackingForegroundService.setState(context, session())
        NotificationActionReceiver.handle(context, TrackingForegroundService.ACTION_PAUSE)

        assertNotNull("alarm should still be armed", storedAlarm())
        fireAlarm()

        // The receiver runs a stale check first; without sync credentials it fails open.
        assertNotNull("reminder should show", waitFor(15_000) { activeNotification() })
    }

    private fun session() = TrackingState(
        taskId,
        "Task",
        System.currentTimeMillis() - 60_000,
        5_000,
        TrackingStateStore.currentBootCount(context)
    )

    private fun fireAlarm() {
        context.sendBroadcast(
            Intent(context, ReminderAlarmReceiver::class.java)
                .setAction(ReminderAlarmReceiver.ACTION_SHOW_REMINDER)
                .putExtra(ReminderAlarmReceiver.EXTRA_NOTIFICATION_ID, notificationId)
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_RELATED_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_TITLE, "Task")
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_TYPE, "TASK")
                .putExtra(ReminderAlarmReceiver.EXTRA_TRIGGER_AT_MS, remindAt),
        )
    }

    private fun storedAlarm(): ReminderAlarmStore.AlarmData? =
        ReminderAlarmStore.getAll(context).firstOrNull { it.notificationId == notificationId }

    private fun activeNotification() =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .activeNotifications.firstOrNull { it.id == notificationId }

    private fun <T> waitFor(timeoutMs: Long, probe: () -> T?): T? {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            probe()?.let { return it }
            SystemClock.sleep(100)
        }
        return null
    }
}
