package com.superproductivity.superproductivity.service

import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.CRT_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.DISMISS_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.PASSWORD
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.SCHEDULE_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.InMemoryKeyCache
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reproduction of the "background reminders stopped working" bug: SuperSync
 * encrypts op payloads end-to-end (mandatory since #8670), so `payload` is a
 * base64 string and the plaintext-JSON parsing found no reminders to schedule.
 *
 * The download-response fixture mirrors GET /api/sync/ops exactly; the
 * ciphertexts (see [com.superproductivity.superproductivity.crypto.EncryptedOpFixtures])
 * were produced by the real JS encrypt() (packages/sync-core) with distinct
 * session salts, like ops from different devices.
 */
class SuperSyncBackgroundProviderTest {

    private fun providerWithDecryptor(): SuperSyncBackgroundProvider =
        SuperSyncBackgroundProvider(OpPayloadDecryptor(PASSWORD, InMemoryKeyCache()))

    @Test
    fun `processes the cancellation after a full page of encrypted reminder ops`() {
        val fixtureOps = JSONObject(ENCRYPTED_DOWNLOAD_RESPONSE).getJSONArray("ops")
        val serverOps = (1..101).map { seq ->
            val fixtureIndex = if (seq <= 99) 0 else seq - 99
            JSONObject(fixtureOps.getJSONObject(fixtureIndex).toString())
                .put("serverSeq", seq)
        }
        val provider = providerWithDecryptor()
        val cursors = mutableListOf<Long>()
        val cancellations = mutableSetOf<String>()
        var cursor = 0L
        var hasMore: Boolean
        do {
            cursors.add(cursor)
            val remaining = serverOps.filter { it.getLong("serverSeq") > cursor }
            val response = JSONObject()
                .put("ops", JSONArray(remaining.take(100)))
                .put("latestSeq", 101)
                .put("hasMore", remaining.size > 100)
            val result = provider.parseResponse(response.toString())
            cancellations.addAll(result.taskIdsToCancel)
            cursor = result.latestSeq
            hasMore = result.hasMore
        } while (hasMore && cursors.size < 3)

        assertEquals(listOf(0L, 100L), cursors)
        assertEquals(setOf("task-dismiss-1"), cancellations)
        assertEquals(101L, cursor)
    }

    @Test
    fun `empty responses preserve the server reset cursor`() {
        val result = SuperSyncBackgroundProvider(null).parseResponse(
            """{"ops": [], "latestSeq": 0, "hasMore": false}"""
        )
        assertEquals(0L, result.latestSeq)
        assertEquals(false, result.hasMore)
    }

    @Test
    fun `schedules reminders from encrypted ops when a decryptor is present`() {
        val result = providerWithDecryptor().parseResponse(ENCRYPTED_DOWNLOAD_RESPONSE)

        val byKey = result.remindersToSchedule.associateBy { Pair(it.taskId, it.isDeadline) }
        assertEquals(3, byKey.size)

        // op-1 (CRT, entityChanges path): remindAt + deadlineRemindAt
        val crtReminder = byKey[Pair("task-crt-1", false)]!!
        assertEquals("Water plants", crtReminder.title)
        assertEquals(4102444500000L, crtReminder.remindAt)
        val crtDeadline = byKey[Pair("task-crt-1", true)]!!
        assertEquals(4102444700000L, crtDeadline.remindAt)

        // op-2 (scheduleTaskWithTime, actionPayload path)
        val schedReminder = byKey[Pair("task-sched-1", false)]!!
        assertEquals("Buy milk", schedReminder.title)
        assertEquals(4102444200000L, schedReminder.remindAt)

        // op-3 (dismissReminderOnly) cancels via the plaintext envelope
        assertEquals(setOf("task-dismiss-1"), result.taskIdsToCancel)
        assertEquals(103L, result.latestSeq)
        assertEquals(false, result.hasMore)
    }

    @Test
    fun `without a decryptor encrypted ops degrade to envelope-only cancels`() {
        val result = SuperSyncBackgroundProvider(null).parseResponse(ENCRYPTED_DOWNLOAD_RESPONSE)

        assertTrue(result.remindersToSchedule.isEmpty())
        assertEquals(setOf("task-dismiss-1"), result.taskIdsToCancel)
        assertEquals(103L, result.latestSeq)
    }

    @Test
    fun `wrong password degrades to envelope-only cancels`() {
        val provider =
            SuperSyncBackgroundProvider(OpPayloadDecryptor("wrong-password", InMemoryKeyCache()))
        val result = provider.parseResponse(ENCRYPTED_DOWNLOAD_RESPONSE)

        assertTrue(result.remindersToSchedule.isEmpty())
        assertEquals(setOf("task-dismiss-1"), result.taskIdsToCancel)
    }

    @Test
    fun `plaintext payloads keep working with and without a decryptor`() {
        val plaintextResponse = """
            {
              "ops": [
                {
                  "serverSeq": 7,
                  "receivedAt": 1755700001000,
                  "op": {
                    "id": "op-plain",
                    "clientId": "client_desktop_1",
                    "actionType": "[Task Shared] scheduleTaskWithTime",
                    "opType": "UPD",
                    "entityType": "TASK",
                    "entityId": "task-plain-1",
                    "payload": {
                      "actionPayload": {
                        "task": { "id": "task-plain-1", "title": "Plain task" },
                        "dueWithTime": 4102444800000,
                        "remindAt": 4102444200000
                      },
                      "entityChanges": []
                    },
                    "vectorClock": { "client_desktop_1": 1 },
                    "timestamp": 1755700000000,
                    "schemaVersion": 6
                  }
                }
              ],
              "hasMore": false,
              "latestSeq": 7
            }
        """.trimIndent()

        for (provider in listOf(SuperSyncBackgroundProvider(null), providerWithDecryptor())) {
            val result = provider.parseResponse(plaintextResponse)
            assertEquals(1, result.remindersToSchedule.size)
            val reminder = result.remindersToSchedule.single()
            assertEquals("task-plain-1", reminder.taskId)
            assertEquals("Plain task", reminder.title)
            assertEquals(4102444200000L, reminder.remindAt)
        }
    }

    // --- Task-field payloads (actionPayload) ---------------------------------
    // Plaintext payloads exercise the same parsing as decrypted E2EE ones.

    private fun op(seq: Long, actionType: String, opType: String, entityId: String, payload: String) =
        JSONObject(
            """
            {
              "serverSeq": $seq,
              "op": {
                "id": "op-$seq",
                "clientId": "client_desktop_1",
                "actionType": "$actionType",
                "opType": "$opType",
                "entityType": "TASK",
                "entityId": "$entityId",
                "payload": $payload,
                "vectorClock": { "client_desktop_1": $seq },
                "timestamp": 1755700000000,
                "schemaVersion": 6
              }
            }
            """.trimIndent()
        )

    private fun parse(vararg ops: JSONObject): ReminderChangeResult =
        SuperSyncBackgroundProvider(null).parseResponse(
            JSONObject()
                .put("ops", JSONArray(ops.toList()))
                .put("latestSeq", ops.size.toLong())
                .put("hasMore", false)
                .toString()
        )

    @Test
    fun `schedules a short-syntax time typed on another device`() {
        // "Call mom @15:00" → applyShortSyntax with the cleaned title in taskChanges
        val result = parse(
            op(
                1, "[Task Shared] applyShortSyntax", "UPD", "task-ss-1",
                """{"actionPayload": {
                    "task": {"id": "task-ss-1", "title": "Call mom @15:00"},
                    "taskChanges": {"title": "Call mom", "dueWithTime": 4102444800000},
                    "schedulingInfo": {"dueWithTime": 4102444800000, "remindAt": 4102444200000, "isMoveToBacklog": false}
                  }, "entityChanges": []}"""
            )
        )

        val reminder = result.remindersToSchedule.single()
        assertEquals("task-ss-1", reminder.taskId)
        assertEquals("Call mom", reminder.title)
        assertEquals(4102444200000L, reminder.remindAt)
        assertEquals(false, reminder.isDeadline)
        assertTrue(result.taskIdsToCancel.isEmpty())
    }

    @Test
    fun `short syntax day planning or a null remindAt neither schedules nor cancels`() {
        // short-syntax-shared.reducer.ts applies schedulingInfo.remindAt only with
        // dueWithTime and as `remindAt ?? undefined`, so the task keeps its reminder.
        val result = parse(
            op(
                1, "[Task Shared] applyShortSyntax", "UPD", "task-ss-2",
                """{"actionPayload": {
                    "task": {"id": "task-ss-2", "title": "Call mom @tomorrow"},
                    "taskChanges": {"title": "Call mom"},
                    "schedulingInfo": {"day": "2100-01-01", "isAddToTop": false}
                  }, "entityChanges": []}"""
            ),
            op(
                2, "[Task Shared] applyShortSyntax", "UPD", "task-ss-3",
                """{"actionPayload": {
                    "task": {"id": "task-ss-3", "title": "Call dad @15:00"},
                    "taskChanges": {"title": "Call dad"},
                    "schedulingInfo": {"dueWithTime": 4102444800000, "remindAt": null}
                  }, "entityChanges": []}"""
            )
        )

        assertTrue(result.remindersToSchedule.isEmpty())
        assertTrue(result.taskIdsToCancel.isEmpty())
    }

    @Test
    fun `a cancel drops reminders collected earlier so a later schedule cannot revive them`() {
        val result = parse(
            op(
                1, "[Task Shared] updateTask", "UPD", "task-rev-1",
                """{"actionPayload": {"task": {"id": "task-rev-1", "changes": {"remindAt": 4102444200000}}}, "entityChanges": []}"""
            ),
            op(
                2, "[Task Shared] updateTask", "UPD", "task-rev-1",
                """{"actionPayload": {"task": {"id": "task-rev-1", "changes": {"remindAt": null}}}, "entityChanges": []}"""
            ),
            op(
                3, "[Task Shared] setDeadline", "UPD", "task-rev-1",
                """{"actionPayload": {"taskId": "task-rev-1", "deadlineDay": "2100-01-01", "deadlineRemindAt": 4102444300000}, "entityChanges": []}"""
            )
        )

        val reminder = result.remindersToSchedule.single()
        assertEquals(true, reminder.isDeadline)
        assertEquals(4102444300000L, reminder.remindAt)
    }

    @Test
    fun `schedules a new reminder time set via updateTask`() {
        val result = parse(
            op(
                1, "[Task Shared] updateTask", "UPD", "task-upd-1",
                """{"actionPayload": {"task": {"id": "task-upd-1", "changes": {"remindAt": 4102444200000, "deadlineRemindAt": 4102444300000}}}, "entityChanges": []}"""
            )
        )

        val byKey = result.remindersToSchedule.associateBy { Pair(it.taskId, it.isDeadline) }
        assertEquals(4102444200000L, byKey[Pair("task-upd-1", false)]!!.remindAt)
        assertEquals(4102444300000L, byKey[Pair("task-upd-1", true)]!!.remindAt)
        assertEquals("Task reminder", byKey[Pair("task-upd-1", false)]!!.title)
    }

    @Test
    fun `a later done op cancels a reminder scheduled earlier in the batch`() {
        val result = parse(
            op(
                1, "[Task Shared] updateTask", "UPD", "task-upd-2",
                """{"actionPayload": {"task": {"id": "task-upd-2", "changes": {"remindAt": 4102444200000}}}, "entityChanges": []}"""
            ),
            op(
                2, "[Task Shared] updateTask", "UPD", "task-upd-2",
                """{"actionPayload": {"task": {"id": "task-upd-2", "changes": {"isDone": true}}}, "entityChanges": []}"""
            )
        )

        assertTrue(result.remindersToSchedule.isEmpty())
        assertEquals(setOf("task-upd-2"), result.taskIdsToCancel)
    }

    @Test
    fun `bulk updateTasks marking tasks done cancels each of them`() {
        val result = parse(
            op(
                1, "[Task Shared] updateTasks", "UPD", "",
                """{"actionPayload": {"tasks": [
                    {"id": "task-bulk-1", "changes": {"isDone": true}},
                    {"id": "task-bulk-2", "changes": {"isDone": true}},
                    {"id": "task-bulk-3", "changes": {"title": "renamed"}}
                  ]}, "entityChanges": []}"""
            )
        )

        assertEquals(setOf("task-bulk-1", "task-bulk-2"), result.taskIdsToCancel)
    }

    @Test
    fun `schedules a reminder carried by addTask`() {
        val result = parse(
            op(
                1, "[Task Shared] addTask", "CRT", "task-add-1",
                """{"actionPayload": {"task": {"id": "task-add-1", "title": "Dentist", "remindAt": 4102444200000, "isDone": false}, "workContextId": "INBOX"}, "entityChanges": []}"""
            )
        )

        val reminder = result.remindersToSchedule.single()
        assertEquals("Dentist", reminder.title)
        assertEquals(4102444200000L, reminder.remindAt)
    }

    @Test
    fun `LWW replace schedules the winning reminder and cancels a winner without one`() {
        val result = parse(
            op(
                1, "[TASK] LWW Update", "UPD", "task-lww-1",
                """{"actionPayload": {"id": "task-lww-1", "title": "Winner", "remindAt": 4102444200000}, "entityChanges": [], "lwwUpdateMode": "replace"}"""
            ),
            op(
                2, "[TASK] LWW Update", "UPD", "task-lww-2",
                """{"actionPayload": {"id": "task-lww-2", "title": "No reminder"}, "entityChanges": [], "lwwUpdateMode": "replace"}"""
            )
        )

        val reminder = result.remindersToSchedule.single()
        assertEquals("task-lww-1", reminder.taskId)
        assertEquals("Winner", reminder.title)
        assertEquals(setOf("task-lww-2"), result.taskIdsToCancel)
    }

    @Test
    fun `LWW patch clearing the reminder out-of-band cancels it`() {
        val result = parse(
            op(
                1, "[TASK] LWW Update", "UPD", "task-lww-3",
                """{"actionPayload": {"id": "task-lww-3", "title": "Patched"}, "entityChanges": [], "lwwUpdateMode": "patch", "clearedFields": ["remindAt"]}"""
            ),
            op(
                2, "[TASK] LWW Update", "UPD", "task-lww-4",
                """{"actionPayload": {"id": "task-lww-4", "title": "Renamed only"}, "entityChanges": [], "lwwUpdateMode": "patch"}"""
            )
        )

        assertTrue(result.remindersToSchedule.isEmpty())
        assertEquals(setOf("task-lww-3"), result.taskIdsToCancel)
    }

    @Test
    fun `a time-preserving LWW snapshot keeps the reminder it sets while clearing the absent deadline`() {
        // preserveTaskSnapshotTime (time-preserving-task-snapshot.util.ts) turns a
        // replace snapshot into a patch listing EVERY absent optional field in
        // clearedFields — deadlineRemindAt included for a task without a deadline.
        val result = parse(
            op(
                1, "[TASK] LWW Update", "UPD", "task-tp-1",
                """{"actionPayload": {"id": "task-tp-1", "title": "Renamed", "isDone": false, "remindAt": 4102444200000},
                    "entityChanges": [], "lwwUpdateMode": "patch",
                    "clearedFields": ["notes", "dueDay", "deadlineDay", "deadlineWithTime", "deadlineRemindAt"]}"""
            )
        )

        val reminder = result.remindersToSchedule.single()
        assertEquals("task-tp-1", reminder.taskId)
        assertEquals(4102444200000L, reminder.remindAt)
        assertEquals(false, reminder.isDeadline)
        // The worker cancels first (clearing a stale deadline alarm), then reschedules
        assertEquals(setOf("task-tp-1"), result.taskIdsToCancel)
        // At fire time the task alarm at that time is current, a deadline alarm is stale
        assertFalse(result.isAlarmStale("task-tp-1", 4102444200000L, "TASK"))
        assertTrue(result.isAlarmStale("task-tp-1", 4102444100000L, "TASK"))
        assertTrue(result.isAlarmStale("task-tp-1", 4102444300000L, "DEADLINE"))
    }

    @Test
    fun `a schedule after an earlier op's cancel supersedes it`() {
        val result = parse(
            op(
                1, "[Task Shared] dismissReminderOnly", "UPD", "task-dr-1",
                """{"actionPayload": {"id": "task-dr-1"}, "entityChanges": []}"""
            ),
            op(
                2, "[Task Shared] updateTask", "UPD", "task-dr-1",
                """{"actionPayload": {"task": {"id": "task-dr-1", "changes": {"remindAt": 4102444200000}}}, "entityChanges": []}"""
            )
        )

        assertEquals(4102444200000L, result.remindersToSchedule.single().remindAt)
        assertTrue(result.taskIdsToCancel.isEmpty())
        assertFalse(result.isAlarmStale("task-dr-1", 4102444200000L, "TASK"))
    }

    @Test
    fun `past reminder times are not scheduled`() {
        val result = parse(
            op(
                1, "[Task Shared] updateTask", "UPD", "task-past-1",
                """{"actionPayload": {"task": {"id": "task-past-1", "changes": {"remindAt": 1000}}}, "entityChanges": []}"""
            )
        )

        assertTrue(result.remindersToSchedule.isEmpty())
        assertTrue(result.taskIdsToCancel.isEmpty())
    }

    companion object {
        private val ENCRYPTED_DOWNLOAD_RESPONSE = """
            {
              "ops": [
                {
                  "serverSeq": 101,
                  "receivedAt": 1755700001000,
                  "op": {
                    "id": "op-1",
                    "clientId": "client_desktop_1",
                    "actionType": "[Task] Add task",
                    "opType": "CRT",
                    "entityType": "TASK",
                    "entityId": "task-crt-1",
                    "payload": "$CRT_CIPHERTEXT",
                    "isPayloadEncrypted": true,
                    "vectorClock": { "client_desktop_1": 7 },
                    "timestamp": 1755700000000,
                    "schemaVersion": 6
                  }
                },
                {
                  "serverSeq": 102,
                  "receivedAt": 1755700002000,
                  "op": {
                    "id": "op-2",
                    "clientId": "client_desktop_1",
                    "actionType": "[Task Shared] scheduleTaskWithTime",
                    "opType": "UPD",
                    "entityType": "TASK",
                    "entityId": "task-sched-1",
                    "payload": "$SCHEDULE_CIPHERTEXT",
                    "isPayloadEncrypted": true,
                    "vectorClock": { "client_desktop_1": 7 },
                    "timestamp": 1755700000000,
                    "schemaVersion": 6
                  }
                },
                {
                  "serverSeq": 103,
                  "receivedAt": 1755700003000,
                  "op": {
                    "id": "op-3",
                    "clientId": "client_desktop_1",
                    "actionType": "[Task Shared] dismissReminderOnly",
                    "opType": "UPD",
                    "entityType": "TASK",
                    "entityId": "task-dismiss-1",
                    "payload": "$DISMISS_CIPHERTEXT",
                    "isPayloadEncrypted": true,
                    "vectorClock": { "client_desktop_1": 7 },
                    "timestamp": 1755700000000,
                    "schemaVersion": 6
                  }
                }
              ],
              "hasMore": false,
              "latestSeq": 103
            }
        """.trimIndent()
    }
}
