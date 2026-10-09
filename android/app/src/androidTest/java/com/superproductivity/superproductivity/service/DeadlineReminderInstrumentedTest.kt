package com.superproductivity.superproductivity.service

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.receiver.ReminderActionReceiver
import com.superproductivity.superproductivity.receiver.ReminderAlarmReceiver
import com.superproductivity.superproductivity.widget.ReminderSnoozeQueue
import com.superproductivity.superproductivity.widget.ReminderTapQueue
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Native half of deadline reminders (#10619): a deadline alarm lives in its own
 * `_deadline` slot next to the task's own reminder, and its fire, snooze and tap
 * paths keep the DEADLINE type so the frontend moves or clears only the deadline
 * reminder. The frontend half is covered by mobile-notification.effects.spec.ts
 * and reminder.module.spec.ts; the WebView round trip is not exercised here.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class DeadlineReminderInstrumentedTest {

    private val context: Context by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
    }
    private val taskId = "instr-deadline-task"
    private val taskNotificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId)
    private val deadlineNotificationId =
        SuperSyncBackgroundProvider.generateNotificationId(taskId + "_deadline")
    private val dueDayNotificationId =
        SuperSyncBackgroundProvider.generateNotificationId(taskId + "_dueday")

    @Before
    fun setUp() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        cleanUp()
    }

    @After
    fun cleanUp() {
        ReminderNotificationHelper.cancelReminder(context, taskNotificationId)
        ReminderNotificationHelper.cancelReminder(context, deadlineNotificationId)
        ReminderNotificationHelper.cancelReminder(context, dueDayNotificationId)
        // A shown reminder also posts the group summary; don't leave it behind.
        NotificationManagerCompat.from(context)
            .cancel(ReminderNotificationHelper.SUMMARY_NOTIFICATION_ID)
        ReminderSnoozeQueue.getAndClear(context)
        ReminderTapQueue.getAndClear(context)
    }

    @Test
    fun syncCancelClearsEveryAlarmSlotOfTheTask() {
        val at = System.currentTimeMillis() + HOUR_MS
        scheduleReminderFromSync(context, ReminderToSchedule(taskId, "Task", at, false))
        scheduleReminderFromSync(context, ReminderToSchedule(taskId, "Task", at, true))
        ReminderNotificationHelper.scheduleReminder(
            context, dueDayNotificationId, taskId + "_dueday", taskId, "Task", "DUE_DATE", at,
        )

        cancelRemindersForTask(context, taskId)

        assertNull(storedAlarm(taskNotificationId))
        assertNull(storedAlarm(dueDayNotificationId))
        assertNull(storedAlarm(deadlineNotificationId))
    }

    @Test
    fun syncedDeadlineAlarmUsesItsOwnSlotNextToTheTaskAlarm() {
        val taskAt = System.currentTimeMillis() + HOUR_MS
        val deadlineAt = taskAt + HOUR_MS
        scheduleReminderFromSync(context, ReminderToSchedule(taskId, "Task", taskAt, false))
        scheduleReminderFromSync(context, ReminderToSchedule(taskId, "Task", deadlineAt, true))

        val task = storedAlarm(taskNotificationId)
        val deadline = storedAlarm(deadlineNotificationId)
        assertNotNull("task alarm should be stored", task)
        assertNotNull("deadline alarm should be stored", deadline)
        assertEquals("TASK", task!!.reminderType)
        assertEquals(taskAt, task.triggerAtMs)
        assertEquals("DEADLINE", deadline!!.reminderType)
        assertEquals(taskId + "_deadline", deadline.reminderId)
        assertEquals(taskId, deadline.relatedId)
        assertEquals(deadlineAt, deadline.triggerAtMs)

        // Clearing the deadline reminder must not touch the task's own alarm.
        ReminderNotificationHelper.cancelReminder(context, deadlineNotificationId)
        assertNull(storedAlarm(deadlineNotificationId))
        assertEquals(taskAt, storedAlarm(taskNotificationId)?.triggerAtMs)
    }

    @Test
    fun firedDeadlineAlarmShowsDeadlineNotificationUntilItsOwnSlotIsCancelled() {
        context.sendBroadcast(
            Intent(context, ReminderAlarmReceiver::class.java)
                .setAction(ReminderAlarmReceiver.ACTION_SHOW_REMINDER)
                .putExtra(ReminderAlarmReceiver.EXTRA_NOTIFICATION_ID, deadlineNotificationId)
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_ID, taskId + "_deadline")
                .putExtra(ReminderAlarmReceiver.EXTRA_RELATED_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_TITLE, "Task")
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_TYPE, "DEADLINE")
                .putExtra(ReminderAlarmReceiver.EXTRA_TRIGGER_AT_MS, System.currentTimeMillis()),
        )

        // The receiver runs a stale check first; without sync credentials it fails
        // open, with them it is bounded by a 5s call timeout.
        val shown = waitFor(15_000) { activeNotification(deadlineNotificationId) }
        assertNotNull("deadline notification should be shown", shown)
        assertEquals(
            "Deadline reminder",
            shown!!.notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString(),
        )

        // Cancelling the task's own slot leaves the shown deadline notification.
        ReminderNotificationHelper.cancelReminder(context, taskNotificationId)
        assertNotNull(activeNotification(deadlineNotificationId))

        ReminderNotificationHelper.cancelReminder(context, deadlineNotificationId)
        val gone = waitFor(5_000) { (activeNotification(deadlineNotificationId) == null).takeIf { it } }
        assertNotNull("deadline notification should be removed", gone)
    }

    @Test
    fun snoozingDeadlineQueuesTypedEventAndMovesOnlyTheDeadlineAlarm() {
        val taskAt = System.currentTimeMillis() + 3 * HOUR_MS
        scheduleReminderFromSync(context, ReminderToSchedule(taskId, "Task", taskAt, false))

        val before = System.currentTimeMillis()
        // Called directly: this receiver does no async work, unlike the alarm receiver.
        ReminderActionReceiver().onReceive(
            context,
            Intent(context, ReminderActionReceiver::class.java)
                .setAction(ReminderActionReceiver.ACTION_SNOOZE)
                .putExtra(ReminderActionReceiver.EXTRA_NOTIFICATION_ID, deadlineNotificationId)
                .putExtra(ReminderActionReceiver.EXTRA_REMINDER_ID, taskId + "_deadline")
                .putExtra(ReminderActionReceiver.EXTRA_RELATED_ID, taskId)
                .putExtra(ReminderActionReceiver.EXTRA_TITLE, "Task")
                .putExtra(ReminderActionReceiver.EXTRA_REMINDER_TYPE, "DEADLINE"),
        )
        val after = System.currentTimeMillis()

        val events = JSONArray(ReminderSnoozeQueue.getAndClear(context))
        assertEquals(1, events.length())
        val event = events.getJSONObject(0)
        assertEquals(taskId, event.getString("taskId"))
        assertEquals("DEADLINE", event.getString("reminderType"))
        val snoozedTo = event.getLong("newRemindAt")
        assertTrue(snoozedTo in (before + SNOOZE_MS)..(after + SNOOZE_MS))

        val deadline = storedAlarm(deadlineNotificationId)
        assertEquals("DEADLINE", deadline?.reminderType)
        assertEquals(snoozedTo, deadline?.triggerAtMs)
        assertEquals(taskAt, storedAlarm(taskNotificationId)?.triggerAtMs)
    }

    @Test
    fun tappingDeadlineNotificationQueuesTypedTap() {
        assertEquals(
            JSONObject().put("taskId", taskId).put("reminderType", "DEADLINE").toString(),
            launchWithReminderTap("DEADLINE"),
        )
    }

    @Test
    fun tappingTaskNotificationQueuesPlainIdForOlderBundles() {
        assertEquals(taskId, launchWithReminderTap("TASK"))
    }

    // CI serves a smoke page that never drains the queue; with the real Angular
    // bundle installed, its startup drain could race this read.
    private fun launchWithReminderTap(reminderType: String): String? {
        val intent = Intent(context, CapacitorMainActivity::class.java)
            .putExtra("REMINDER_TASK_ID", taskId)
            .putExtra("REMINDER_TYPE", reminderType)
        ActivityScenario.launch<CapacitorMainActivity>(intent).use {
            return ReminderTapQueue.getAndClear(context)
        }
    }

    private fun storedAlarm(notificationId: Int): ReminderAlarmStore.AlarmData? =
        ReminderAlarmStore.getAll(context).firstOrNull { it.notificationId == notificationId }

    private fun activeNotification(notificationId: Int) =
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .activeNotifications.firstOrNull { it.id == notificationId }

    private fun <T> waitFor(timeoutMs: Long, probe: () -> T?): T? {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            probe()?.let { return it }
            SystemClock.sleep(100)
        }
        return probe()
    }

    private companion object {
        const val HOUR_MS = 60 * 60 * 1000L
        const val SNOOZE_MS = ReminderActionReceiver.SNOOZE_DURATION_MS
    }
}
