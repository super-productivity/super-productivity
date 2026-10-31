package com.superproductivity.superproductivity.service

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * End to end on a device for WebDAV/Nextcloud: a mock server serves the v2
 * sync-data.json with ETags, the real [SyncReminderWorker] runs while no
 * WebView exists, and the registered alarms are checked.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class FileSyncReminderInstrumentedTest {

    private val context: Context by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
    }

    private lateinit var server: MockWebServer

    @Volatile private var fileBody = syncFile("{}")
    @Volatile private var fileETag = "\"v1\""
    /** Requests the server answered with the full file (not 304). */
    @Volatile private var fullDownloads = 0

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.requestUrl?.encodedPath != "/dav/sync-data.json") return MockResponse().setResponseCode(404)
                if (request.getHeader("Authorization") != AUTH) return MockResponse().setResponseCode(401)
                if (request.getHeader("If-None-Match") == fileETag) return MockResponse().setResponseCode(304)
                fullDownloads++
                return MockResponse().setBody(fileBody).setHeader("ETag", fileETag)
            }
        }
        server.start()
        cleanUp()
        saveCredentials(isEncryptionExpected = false)
    }

    @After
    fun tearDown() {
        cleanUp()
        server.shutdown()
    }

    private fun cleanUp() {
        BackgroundSyncCredentialStore.clearFileSync(context)
        BackgroundSyncCredentialStore.clear(context)
        BackgroundReminderSettingsStore.save(context, isDisabled = false, useAlarmStyle = false)
        for (taskId in listOf(TIMED, DUE_DAY, UNKNOWN)) cancelRemindersForTask(context, taskId)
    }

    @Test
    fun schedulesRemindersFromTheFileAndSkipsAnUnchangedFile() {
        fileBody = syncFile(
            """{"$TIMED":{"id":"$TIMED","title":"Pay rent","remindAt":$FAR_FUTURE,"deadlineRemindAt":${FAR_FUTURE + 1}}}"""
        )

        assertEquals(ListenableWorker.Result.success(), runWorker())

        val alarm = storedAlarm(TIMED)
        assertNotNull("timed reminder should be scheduled", alarm)
        assertEquals(FAR_FUTURE, alarm!!.triggerAtMs)
        assertEquals("Pay rent", alarm.title)
        assertEquals(FAR_FUTURE + 1, storedAlarm(TIMED + "_deadline")!!.triggerAtMs)

        runWorker()
        assertEquals("unchanged file is answered with 304", 1, fullDownloads)
    }

    @Test
    fun firstRunCancelsNoAlarmTheFileDoesNotMention() {
        seedAlarm(UNKNOWN, "TASK", UNKNOWN)

        runWorker()

        assertNotNull("first run has no baseline and must not cancel", storedAlarm(UNKNOWN))
    }

    @Test
    fun taskDoneOnAnotherDeviceCancelsItsAlarmsIncludingDueDay() {
        fileBody = syncFile(
            """{"$TIMED":{"id":"$TIMED","remindAt":$FAR_FUTURE},
                "$DUE_DAY":{"id":"$DUE_DAY","dueDay":"2099-12-31"}}"""
        )
        runWorker()
        // the app sets the due-day alarm itself; the worker only cancels it
        seedAlarm(DUE_DAY, "DUE_DATE", DUE_DAY + "_dueday")
        assertNotNull(storedAlarm(TIMED))

        fileBody = syncFile(
            """{"$TIMED":{"id":"$TIMED","remindAt":$FAR_FUTURE,"isDone":true},
                "$DUE_DAY":{"id":"$DUE_DAY","dueDay":"2099-12-31","isDone":true}}"""
        )
        fileETag = "\"v2\""
        runWorker()

        assertNull("done task's reminder should be cancelled", storedAlarm(TIMED))
        assertNull("done task's due-day alarm should be cancelled", storedAlarm(DUE_DAY + "_dueday"))
    }

    @Test
    fun unreadableFileIsNotDownloadedAgainUntilThePasswordChanges() {
        saveCredentials(isEncryptionExpected = true)
        fileBody = syncFile("""{"$TIMED":{"id":"$TIMED","remindAt":$FAR_FUTURE}}""")

        runWorker()
        assertNull("plaintext file is refused when encryption is expected", storedAlarm(TIMED))
        runWorker()
        assertEquals("unreadable but unchanged file is not downloaded again", 1, fullDownloads)

        BackgroundSyncCredentialStore.setEncryptionPassword(context, "new-password")
        runWorker()
        assertEquals("password change downloads the file again", 2, fullDownloads)
    }

    // --- Helpers --------------------------------------------------------------

    private fun saveCredentials(isEncryptionExpected: Boolean) {
        BackgroundSyncCredentialStore.saveFileSync(
            context,
            BackgroundSyncCredentialStore.FileSyncCredentials(
                server.url("/dav/sync-data.json").toString(),
                AUTH,
                isEncryptionExpected,
            ),
        )
    }

    private fun syncFile(tasks: String): String =
        """pf_2__{"version":2,"syncVersion":1,"vectorClock":{"a":1},
           "state":{"project":{"ids":[],"entities":{}},"task":{"ids":[],"entities":$tasks}}}"""

    private fun runWorker(): ListenableWorker.Result =
        TestListenableWorkerBuilder.from(context, SyncReminderWorker::class.java).build().startWork().get()

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

    private fun storedAlarm(reminderId: String): ReminderAlarmStore.AlarmData? {
        val id = SuperSyncBackgroundProvider.generateNotificationId(reminderId)
        return ReminderAlarmStore.getAll(context).firstOrNull { it.notificationId == id }
    }

    private companion object {
        const val AUTH = "Basic dXNlcjpwYXNz"
        const val TIMED = "file-task-timed"
        const val DUE_DAY = "file-task-dueday"
        const val UNKNOWN = "file-task-unknown"
        const val FAR_FUTURE = 4102444900000L
    }
}
