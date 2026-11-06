package com.superproductivity.superproductivity.service

import com.superproductivity.superproductivity.crypto.InMemoryKeyCache
import com.superproductivity.superproductivity.crypto.OpPayloadDecryptor
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import kotlin.io.encoding.Base64

/**
 * Parses ops the app really produces (test resource
 * background-reminder-ops.json, pinned to the JS action creators and LWW op
 * builders by background-reminder-ops.spec.ts) and checks which alarms the
 * background worker would schedule and cancel for each.
 *
 * The live variant runs the same payloads through the REAL JS encrypt() —
 * encrypted on every CI run by tools/generate-android-crypto-fixtures.mjs —
 * so the E2EE path is covered with production payloads too. It is skipped
 * when the fixture file is absent (plain local runs).
 */
class BackgroundReminderOpFixturesTest {

    private data class Case(
        val name: String,
        val op: JSONObject,
        val expectSchedule: Set<ReminderToSchedule>,
        val expectCancel: Set<String>,
    )

    private val cases: List<Case> by lazy {
        val text = javaClass.classLoader!!.getResource(FIXTURE_RESOURCE)!!.readText()
        val arr = JSONArray(text)
        (0 until arr.length()).map { i ->
            val c = arr.getJSONObject(i)
            val schedules = c.getJSONArray("expectSchedule")
            val cancels = c.getJSONArray("expectCancel")
            Case(
                name = c.getString("name"),
                op = c.getJSONObject("op"),
                expectSchedule = (0 until schedules.length()).map { j ->
                    val s = schedules.getJSONObject(j)
                    ReminderToSchedule(
                        s.getString("taskId"),
                        s.getString("title"),
                        s.getLong("remindAt"),
                        s.getBoolean("isDeadline"),
                    )
                }.toSet(),
                expectCancel = (0 until cancels.length()).map { cancels.getString(it) }.toSet(),
            )
        }
    }

    private fun parseSingleOp(provider: SuperSyncBackgroundProvider, op: JSONObject): ReminderChangeResult =
        provider.parseResponse(
            JSONObject()
                .put("ops", JSONArray().put(JSONObject().put("serverSeq", 1).put("op", op)))
                .put("latestSeq", 1)
                .put("hasMore", false)
                .toString()
        )

    private fun assertCase(case: Case, result: ReminderChangeResult) {
        assertEquals("${case.name}: scheduled", case.expectSchedule, result.remindersToSchedule.toSet())
        assertEquals("${case.name}: cancelled", case.expectCancel, result.taskIdsToCancel)
        // The fire-time check must keep every reminder this op (re)sets…
        for (r in result.remindersToSchedule) {
            val type = if (r.isDeadline) "DEADLINE" else "TASK"
            assertFalse("${case.name}: own alarm judged stale", result.isAlarmStale(r.taskId, r.remindAt, type))
            // …and drop an alarm of that slot set for another time
            assertTrue("${case.name}: moved alarm kept", result.isAlarmStale(r.taskId, r.remindAt + 60_000, type))
        }
    }

    @Test
    fun `parses the ops the app produces`() {
        assertTrue("fixture has no cases", cases.size >= 10)
        for (case in cases) {
            assertCase(case, parseSingleOp(SuperSyncBackgroundProvider(null), case.op))
        }
    }

    @Test
    fun `parses the same ops encrypted by the real JS implementation`() {
        val file = listOfNotNull(System.getenv("LIVE_CRYPTO_FIXTURES"), "build/live-crypto-fixtures.tsv")
            .map(::File)
            .firstOrNull { it.isFile }
        assumeTrue("live fixtures not generated - skipping", file != null)

        var password: String? = null
        val ciphertexts = mutableMapOf<String, String>()
        file!!.readLines().forEach { line ->
            val parts = line.split('\t')
            when (parts.firstOrNull()) {
                "password" -> password = String(Base64.decode(parts[1]), Charsets.UTF_8)
                "entry" -> if (parts[1].startsWith(LIVE_ENTRY_PREFIX)) {
                    ciphertexts[parts[1].removePrefix(LIVE_ENTRY_PREFIX)] = parts[3]
                }
            }
        }
        assertEquals("every fixture op is encrypted live", cases.map { it.name }.toSet(), ciphertexts.keys)

        val provider = SuperSyncBackgroundProvider(OpPayloadDecryptor(password!!, InMemoryKeyCache()))
        for (case in cases) {
            val encryptedOp = JSONObject(case.op.toString())
                .put("payload", ciphertexts.getValue(case.name))
                .put("isPayloadEncrypted", true)
            assertCase(case, parseSingleOp(provider, encryptedOp))
        }
    }

    @Test
    fun `flags a task whose op it cannot read yet, until the session key is derived`() {
        // A done op from a desktop session this phone has no key for yet
        val fixture = JSONObject(javaClass.classLoader!!.getResource(ENCRYPTED_DONE_RESOURCE)!!.readText())
        val password = fixture.getString("password")
        val taskId = fixture.getString("taskId")
        val op = fixture.getJSONObject("op")
        val cache = InMemoryKeyCache()

        val cold = parseSingleOp(SuperSyncBackgroundProvider(OpPayloadDecryptor(password, cache, deriveOnMiss = false)), op)
        assertEquals(emptySet<String>(), cold.taskIdsToCancel)
        assertEquals(setOf(taskId), cold.unreadableTaskIds)

        val derived = parseSingleOp(SuperSyncBackgroundProvider(OpPayloadDecryptor(password, cache)), op)
        assertEquals(setOf(taskId), derived.taskIdsToCancel)
        assertEquals(emptySet<String>(), derived.unreadableTaskIds)
    }

    companion object {
        private const val FIXTURE_RESOURCE = "background-reminder-ops.json"
        private const val ENCRYPTED_DONE_RESOURCE = "encrypted-done-op.json"

        // Must match tools/generate-android-crypto-fixtures.mjs
        private const val LIVE_ENTRY_PREFIX = "reminder-op:"
    }
}
