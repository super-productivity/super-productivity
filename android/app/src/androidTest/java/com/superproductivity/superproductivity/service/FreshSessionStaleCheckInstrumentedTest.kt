package com.superproductivity.superproductivity.service

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.receiver.ReminderAlarmReceiver
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A task completed on desktop rings on the phone when the done op comes from a
 * desktop session the background worker has not decrypted yet: every desktop
 * launch encrypts with a new salt, and the alarm's fire-time check only had
 * keys the worker derived earlier.
 *
 * The op is the updateTaskDone case of background-reminder-ops.json (data
 * shape pinned by background-reminder-ops.spec.ts), encrypted once with
 * sync-core's encrypt() into encrypted-done-op.json. That file is a frozen
 * snapshot; KDF or wire-format drift is caught by the per-run fixtures of
 * tools/generate-android-crypto-fixtures.mjs. The key cache starts cold, as
 * it is right after a desktop restart.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class FreshSessionStaleCheckInstrumentedTest {

    private val context: Context by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
    }

    private val fixture: JSONObject by lazy {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        JSONObject(assets.open(FIXTURE_ASSET).bufferedReader().use { it.readText() })
    }
    private val taskId: String by lazy { fixture.getString("taskId") }

    private lateinit var server: MockWebServer

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
                return MockResponse().setBody(opsResponse().toString())
            }
        }
        server.start()
        val baseUrl = server.url("/").toString()
        // clear() also drops the derived-key cache: no desktop session is known yet
        BackgroundSyncCredentialStore.clear(context)
        cancelRemindersForTask(context, taskId)
        BackgroundSyncCredentialStore.save(context, baseUrl, "instr-token")
        BackgroundSyncCredentialStore.setLastServerSeq(context, baseUrl, 0L)
        BackgroundSyncCredentialStore.setEncryptionPassword(context, fixture.getString("password"))
    }

    @After
    fun tearDown() {
        cancelRemindersForTask(context, taskId)
        BackgroundSyncCredentialStore.clear(context)
        server.shutdown()
    }

    private fun opsResponse(): JSONObject {
        val op = JSONObject(fixture.getJSONObject("op").toString())
            .put("id", "op-1")
            .put("clientId", "client_desktop_1")
            .put("vectorClock", JSONObject().put("client_desktop_1", 1))
            .put("timestamp", 1755700000000L)
            .put("schemaVersion", 6)
        val serverOp = JSONObject().put("serverSeq", 1L).put("receivedAt", 1755700000000L).put("op", op)
        return JSONObject().put("ops", JSONArray().put(serverOp)).put("latestSeq", 1L).put("hasMore", false)
    }

    @Test
    fun firedAlarmForATaskCompletedInAnUnseenDesktopSessionIsSuppressed() {
        val notificationId = SuperSyncBackgroundProvider.generateNotificationId(taskId)
        ReminderNotificationHelper.scheduleReminder(
            context, notificationId, taskId, taskId, "Seeded", "TASK", FAR_FUTURE,
        )

        context.sendBroadcast(
            Intent(context, ReminderAlarmReceiver::class.java)
                .setAction(ReminderAlarmReceiver.ACTION_SHOW_REMINDER)
                .putExtra(ReminderAlarmReceiver.EXTRA_NOTIFICATION_ID, notificationId)
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_RELATED_ID, taskId)
                .putExtra(ReminderAlarmReceiver.EXTRA_TITLE, "Fired")
                .putExtra(ReminderAlarmReceiver.EXTRA_REMINDER_TYPE, "TASK")
                .putExtra(ReminderAlarmReceiver.EXTRA_TRIGGER_AT_MS, FAR_FUTURE),
        )

        assertNotNull(
            "stale alarm should be unregistered",
            waitFor(15_000) { ReminderAlarmStore.getAll(context).none { it.notificationId == notificationId }.takeIf { it } },
        )
        assertNull("reminder of a task done on desktop must not be shown", activeNotification(notificationId))
    }

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
        const val FIXTURE_ASSET = "encrypted-done-op.json"
        const val FAR_FUTURE = 4102444900000L
    }
}
