package com.superproductivity.superproductivity.service

import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.CRT_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.DISMISS_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.PASSWORD
import com.superproductivity.superproductivity.crypto.EncryptedOpFixtures.SCHEDULE_CIPHERTEXT
import com.superproductivity.superproductivity.crypto.InMemoryKeyCache
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
import org.junit.Assert.assertEquals
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
    fun `schedules reminders from encrypted ops when a decryptor is present`() {
        val result = providerWithDecryptor().parseResponse(ENCRYPTED_DOWNLOAD_RESPONSE)

        val byKey = result.remindersToSchedule.associateBy { Pair(it.taskId, it.isDueDate) }
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
