package com.superproductivity.superproductivity.service

import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures
import com.superproductivity.superproductivity.crypto.InMemoryKeyCache
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream
import kotlin.io.encoding.Base64

class SyncFileReminderReaderTest {

    private fun file(tasks: String, projects: String = "{}", version: Int = 2): String =
        """{"version":$version,"syncVersion":3,"vectorClock":{"a":1},
           "state":{"project":{"ids":[],"entities":$projects},"task":{"ids":[],"entities":$tasks}},
           "archiveYoung":{"task":{"entities":{"old":{"id":"old","remindAt":4102444500000}}}},
           "recentOps":[]}"""

    private fun read(body: String, isEncryptionExpected: Boolean = false) =
        SyncFileReminderReader.read(body, null, isEncryptionExpected)

    private fun gzipB64(text: String): String {
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        return Base64.encode(out.toByteArray())
    }

    @Test
    fun `reads remindAt and deadline reminders from a plain file`() {
        val body = "pf_2__" + file(
            """{"t1":{"id":"t1","title":"Pay rent","remindAt":4102444500000,"deadlineRemindAt":4102444700000,"isDone":false}}"""
        )
        assertEquals(
            SyncFileReadResult.Reminders(
                listOf(
                    ReminderToSchedule("t1", "Pay rent", 4102444500000, isDeadline = false),
                    ReminderToSchedule("t1", "Pay rent", 4102444700000, isDeadline = true),
                )
            ),
            read(body),
        )
    }

    @Test
    fun `reads a compressed file`() {
        val body = "pf_C2__" + gzipB64(file("""{"t1":{"id":"t1","title":"A","remindAt":5}}"""))
        assertEquals(SyncFileReadResult.Reminders(listOf(ReminderToSchedule("t1", "A", 5, false))), read(body))
    }

    @Test
    fun `reads a file compressed and encrypted by the real JS implementation`() {
        // Generated with sync-core compressWithGzipToString + encrypt, see test resources
        val body = javaClass.classLoader!!.getResource("encrypted-sync-data.txt")!!.readText().trim()
        val decryptor = OpPayloadDecryptor(EncryptedOpFixtures.PASSWORD, InMemoryKeyCache())
        assertEquals(
            SyncFileReadResult.Reminders(listOf(ReminderToSchedule("t1", "Pay rent", 4102444500000, false))),
            SyncFileReminderReader.read(body, decryptor, isEncryptionExpected = true),
        )
    }

    @Test
    fun `refuses a plaintext file when encryption is expected`() {
        val body = "pf_2__" + file("""{"t1":{"id":"t1","title":"Injected","remindAt":5}}""")
        assertEquals(SyncFileReadResult.Unreadable("plaintext"), read(body, isEncryptionExpected = true))
    }

    @Test
    fun `encrypted file without password or with a wrong one is unreadable`() {
        val body = javaClass.classLoader!!.getResource("encrypted-sync-data.txt")!!.readText().trim()
        assertEquals(SyncFileReadResult.Unreadable("no-password"), read(body, isEncryptionExpected = true))
        val wrong = OpPayloadDecryptor("wrong", InMemoryKeyCache())
        assertEquals(SyncFileReadResult.Unreadable("decrypt"), SyncFileReminderReader.read(body, wrong, true))
    }

    @Test
    fun `skips done tasks and tasks in archived projects`() {
        val body = "pf_2__" + file(
            """{"done":{"id":"done","remindAt":5,"isDone":true},
                "arch":{"id":"arch","remindAt":5,"projectId":"p1"},
                "live":{"id":"live","remindAt":5,"projectId":"p2"}}""",
            projects = """{"p1":{"id":"p1","isArchived":true},"p2":{"id":"p2","isArchived":false}}""",
        )
        assertEquals(
            SyncFileReadResult.Reminders(listOf(ReminderToSchedule("live", "Task reminder", 5, false))),
            read(body),
        )
    }

    @Test
    fun `ignores null and zero reminder values`() {
        val body = "pf_2__" + file("""{"t1":{"id":"t1","remindAt":null,"deadlineRemindAt":0}}""")
        assertEquals(SyncFileReadResult.Reminders(emptyList()), read(body))
    }

    @Test
    fun `unknown shapes are unreadable rather than empty`() {
        assertEquals(SyncFileReadResult.Unreadable("prefix"), read("{}"))
        assertEquals(SyncFileReadResult.Unreadable("split-format"), read("""pf_2__{"version":3,"format":"split"}"""))
        assertEquals(SyncFileReadResult.Unreadable("no-task-state"), read("""pf_2__{"version":2,"state":{}}"""))
        assertEquals(SyncFileReadResult.Unreadable("parse:EOFException"), read("""pf_2__{"version":2,"""))
    }
}
