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
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.superproductivity.superproductivity.receiver.ReminderAlarmReceiver
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * End to end on a device: a mock SuperSync server serves ops the app really
 * produces (background-reminder-ops.json, pinned to the JS action creators by
 * background-reminder-ops.spec.ts), the real [SyncReminderWorker] runs while
 * no WebView exists, and the registered alarms are checked — the "timed task
 * created on desktop rings on the closed phone" path. The fire-time half sends
 * alarms through the real [ReminderAlarmReceiver] against the same server.
 *
 * Payloads are plaintext here (no E2EE password mirrored); decryption of the
 * same payloads is covered by BackgroundReminderOpFixturesTest (JVM, live
 * ciphertexts from the real JS encrypt()).
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class BackgroundReminderSyncInstrumentedTest {

    private data class Expected(val taskId: String, val title: String, val remindAt: Long, val isDeadline: Boolean)

    private val context: Context by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
    }

    private val fixture: JSONArray by lazy {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        JSONArray(assets.open(FIXTURE_ASSET).bufferedReader().use { it.readText() })
    }
    private val expectedSchedules: List<Expected> by lazy {
        (0 until fixture.length()).flatMap { i ->
            val schedules = fixture.getJSONObject(i).getJSONArray("expectSchedule")
            (0 until schedules.length()).map { j ->
                val s = schedules.getJSONObject(j)
                Expected(s.getString("taskId"), s.getString("title"), s.getLong("remindAt"), s.getBoolean("isDeadline"))
            }
        }
    }
    private val expectedCancels: Set<String> by lazy {
        (0 until fixture.length()).flatMap { i ->
            val cancels = fixture.getJSONObject(i).getJSONArray("expectCancel")
            (0 until cancels.length()).map { cancels.getString(it) }
        }.toSet()
    }
    private val allTaskIds: Set<String> by lazy {
        (0 until fixture.length()).map { fixture.getJSONObject(it).getJSONObject("op").getString("entityId") }
            .toSet() + expectedSchedules.map { it.taskId } + expectedCancels
    }

    private lateinit var server: MockWebServer
    private lateinit var baseUrl: String

    @Before
    fun setUp() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
                context.packageName,
                Manifest.permission.POST_NOTIFICATIONS,
            )
        }
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.requestUrl?.encodedPath != "/api/sync/ops") return MockResponse().setResponseCode(404)
                val sinceSeq = request.requestUrl?.queryParameter("sinceSeq")?.toLongOrNull() ?: 0L
                return MockResponse().setBody(opsResponse(sinceSeq).toString())
            }
        }
        server.start()
        baseUrl = server.url("/").toString()
        cleanUp()
        BackgroundSyncCredentialStore.save(context, baseUrl, "instr-token")
        BackgroundSyncCredentialStore.setLastServerSeq(context, baseUrl, 0L)
    }

    @After
    fun tearDown() {
        cleanUp()
        server.shutdown()
    }

    private fun cleanUp() {
        BackgroundSyncCredentialStore.clear(context)
        BackgroundReminderSettingsStore.save(context, isDisabled = false, useAlarmStyle = false)
        for (taskId in allTaskIds) cancelRemindersForTask(context, taskId)
        cancelRemindersForTask(context, DAY_ONLY_TASK_ID)
        NotificationManagerCompat.from(context).cancel(ReminderNotificationHelper.SUMMARY_NOTIFICATION_ID)
    }

    /** GET /api/sync/ops: every fixture op once, in order, as the server pages them. */
    private fun opsResponse(sinceSeq: Long): JSONObject {
        val ops = JSONArray()
        for (i in 0 until fixture.length()) {
            val seq = i + 1L
            if (seq <= sinceSeq) continue
            ops.put(
                JSONObject()
                    .put("serverSeq", seq)
                    .put("receivedAt", 1755700000000L)
                    .put(
                        "op",
                        JSONObject(fixture.getJSONObject(i).getJSONObject("op").toString())
                            .put("id", "op-$seq")
                            .put("clientId", "client_desktop_1")
                            .put("vectorClock", JSONObject().put("client_desktop_1", seq))
                            .put("timestamp", 1755700000000L)
                            .put("schemaVersion", 6),
                    ),
            )
        }
        return JSONObject().put("ops", ops).put("latestSeq", fixture.length().toLong()).put("hasMore", false)
    }

    // --- Background worker ----------------------------------------------------

    @Test
    fun workerSchedulesRemindersSetOnAnotherDeviceWhileTheAppIsClosed() {
        seedAlarmsThatMustBeCancelled()
        seedAlarm(DAY_ONLY_TASK_ID, "TASK", DAY_ONLY_TASK_ID)

        assertEquals(ListenableWorker.Result.success(), runWorker())

        for (e in expectedSchedules) {
            val alarm = storedAlarm(slotId(e.taskId, e.isDeadline))
            assertNotNull("alarm for ${e.taskId} (deadline=${e.isDeadline}) should be scheduled", alarm)
            assertEquals(e.remindAt, alarm!!.triggerAtMs)
            assertEquals(e.title, alarm.title)
            assertEquals(if (e.isDeadline) "DEADLINE" else "TASK", alarm.reminderType)
            assertFalse(alarm.useAlarmStyle)
        }
        assertCancelledSlotsAreGone()
        // Planning for a day only keeps the task's reminder in the app, so its alarm must stay
        assertNotNull("day-only short syntax must not cancel", storedAlarm(DAY_ONLY_TASK_ID))
        assertEquals(fixture.length().toLong(), BackgroundSyncCredentialStore.getLastServerSeq(context, baseUrl))
    }

    @Test
    fun workerUsesAlarmStyleWhenTheUserEnabledIt() {
        BackgroundReminderSettingsStore.save(context, isDisabled = false, useAlarmStyle = true)

        runWorker()

        val e = expectedSchedules.first { !it.isDeadline }
        val alarm = storedAlarm(slotId(e.taskId, false))
        assertNotNull(alarm)
        assertTrue(alarm!!.useAlarmStyle)
        assertTrue("alarm-style reminders are ongoing, like in the app", alarm.isOngoing)
    }

    @Test
    fun workerSchedulesNothingWhileRemindersAreDisabledButStillCancels() {
        BackgroundReminderSettingsStore.save(context, isDisabled = true, useAlarmStyle = false)
        seedAlarmsThatMustBeCancelled()

        assertEquals(ListenableWorker.Result.success(), runWorker())

        // Expected schedules of tasks that are not also cancelled must not appear
        for (e in expectedSchedules.filter { it.taskId !in expectedCancels }) {
            assertNull("no alarm while reminders are disabled: ${e.taskId}", storedAlarm(slotId(e.taskId, e.isDeadline)))
        }
        assertCancelledSlotsAreGone(includingRescheduled = true)
        // Re-enabling reschedules from the app's full state, so the cursor may advance
        assertEquals(fixture.length().toLong(), BackgroundSyncCredentialStore.getLastServerSeq(context, baseUrl))
    }

    // --- Fire-time check ------------------------------------------------------

    @Test
    fun firedAlarmForAReminderStillCurrentOnTheServerIsShown() {
        // The time-preserving conflict winner both cancels and re-sets this
        // task's reminder; the alarm at that time is the current one.
        val e = expectedSchedules.first { it.taskId in expectedCancels && !it.isDeadline }
        val id = slotId(e.taskId, false)

        fireAlarm(id, e.taskId, "TASK", e.remindAt)

        assertNotNull("current reminder must be shown", waitFor(15_000) { activeNotification(id) })
    }

    @Test
    fun firedAlarmForATaskCompletedOnAnotherDeviceIsSuppressed() {
        val taskId = expectedCancels.first { c -> expectedSchedules.none { it.taskId == c } }
        val id = slotId(taskId, false)
        seedAlarm(taskId, "TASK", taskId)

        fireAlarm(id, taskId, "TASK", FAR_FUTURE)

        assertNotNull("stale alarm should be unregistered", waitFor(15_000) { (storedAlarm(id) == null).takeIf { it } })
        assertNull("stale reminder must not be shown", activeNotification(id))
    }

    @Test
    fun firedAlarmIsDroppedWhileRemindersAreDisabled() {
        val e = expectedSchedules.first { it.taskId !in expectedCancels && !it.isDeadline }
        val id = slotId(e.taskId, false)
        seedAlarm(e.taskId, "TASK", e.taskId)
        BackgroundReminderSettingsStore.save(context, isDisabled = true, useAlarmStyle = false)

        fireAlarm(id, e.taskId, "TASK", e.remindAt)

        assertNotNull("alarm should be unregistered", waitFor(15_000) { (storedAlarm(id) == null).takeIf { it } })
        assertNull("no reminder while reminders are disabled", activeNotification(id))
    }

    // --- Helpers --------------------------------------------------------------

    private fun runWorker(): ListenableWorker.Result =
        TestListenableWorkerBuilder.from(context, SyncReminderWorker::class.java).build().startWork().get()

    /** Alarms in every slot of the tasks the ops cancel, as if set earlier. */
    private fun seedAlarmsThatMustBeCancelled() {
        for (taskId in expectedCancels) {
            seedAlarm(taskId, "TASK", taskId)
            seedAlarm(taskId, "DEADLINE", taskId + "_deadline")
            seedAlarm(taskId, "DUE_DATE", taskId + "_dueday")
        }
    }

    private fun assertCancelledSlotsAreGone(includingRescheduled: Boolean = false) {
        for (taskId in expectedCancels) {
            val rescheduled = expectedSchedules.filter { it.taskId == taskId }
            for ((reminderId, isDeadline) in listOf(taskId to false, taskId + "_deadline" to true, taskId + "_dueday" to null)) {
                val keptBySchedule = !includingRescheduled && rescheduled.any { it.isDeadline == isDeadline }
                if (keptBySchedule) continue
                assertNull("$reminderId should be cancelled", storedAlarm(SuperSyncBackgroundProvider.generateNotificationId(reminderId)))
            }
        }
    }

    private fun seedAlarm(taskId: String, type: String, reminderId: String) {
        ReminderNotificationHelper.scheduleReminder(
            context,
            SuperSyncBackgroundProvider.generateNotificationId(reminderId),
            reminderId,
            taskId,
            "Seeded",
            type,
            FAR_FUTURE,
        )
    }

    private fun fireAlarm(notificationId: Int, taskId: String, type: String, triggerAtMs: Long) {
        context.sendBroadcast(
            Intent(context, ReminderAlarmReceiver::class.java)
                .setAction(ReminderAlarmReceiver.ACTION_SHOW_REMINDER)
                .putExtra(ReminderAlarmReceiver.EXTRA_NOTIFICATION_ID, notificationId)
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_RELATED_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_TITLE, "Fired")
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_TYPE, type)
                .putExtra(ReminderAlarmReceiver.EXTRA_TRIGGER_AT_MS, triggerAtMs),
        )
    }

    private fun slotId(taskId: String, isDeadline: Boolean): Int =
        SuperSyncBackgroundProvider.generateNotificationId(if (isDeadline) taskId + "_deadline" else taskId)

    private fun storedAlarm(notificationId: Int): ReminderAlarmStore.AlarmData? =
        ReminderAlarmStore.getAll(context).firstOrNull { it.notificationId == notificationId }

    private fun storedAlarm(reminderId: String): ReminderAlarmStore.AlarmData? =
        storedAlarm(SuperSyncBackgroundProvider.generateNotificationId(reminderId))

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
        const val FIXTURE_ASSET = "background-reminder-ops.json"
        // Not in the fixture's expectations: day-only short syntax leaves it alone
        const val DAY_ONLY_TASK_ID = "task-ss-day"
        const val FAR_FUTURE = 4102444900000L
    }
}
