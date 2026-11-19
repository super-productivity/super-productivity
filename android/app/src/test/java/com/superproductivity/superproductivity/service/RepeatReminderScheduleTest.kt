package com.superproductivity.superproductivity.service

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/**
 * The Kotlin port of getUpcomingRepeatReminders must match the timestamps
 * tools/generate-repeat-reminder-fixtures.mjs produced from that function.
 */
class RepeatReminderScheduleTest {

    @Test
    fun `fixtures match the TypeScript reminder function`() {
        val json = JSONObject(
            javaClass.classLoader!!.getResource("repeat-reminder-fixtures.json")!!.readText(),
        )
        assertEquals(14, json.getInt("lookaheadDays"))
        assertEquals(32, json.getInt("maxScheduled"))
        val cases = json.getJSONArray("cases")
        assertTrue(cases.length() >= 10)
        for (i in 0 until cases.length()) {
            val entry = cases.getJSONObject(i)
            val name = entry.getString("name")
            val cfgs = entry.getJSONArray("cfgs").toCfgList()
            val state = RepeatCfgSyncState(
                cfgs,
                entry.getJSONArray("archivedProjectIds").toStringSet(),
            )
            val got = upcomingRepeatReminders(
                state,
                entry.getLong("now"),
                TimeZone.getTimeZone(entry.getString("timeZone")),
                entry.getLong("startOfNextDayDiffMs"),
                soonestFirst = entry.getBoolean("soonestFirst"),
            )
            val expect = entry.getJSONArray("expect")
            assertEquals("$name count", expect.length(), got.size)
            for (row in 0 until expect.length()) {
                val expected = expect.getJSONObject(row)
                assertEquals("$name id", expected.getString("taskId"), got[row].taskId)
                assertEquals("$name trigger", expected.getLong("triggerAtMs"), got[row].remindAt)
                assertEquals("$name title", expected.optString("title", ""), got[row].title)
                assertEquals("$name not a deadline", false, got[row].isDeadline)
            }
        }
    }

    @Test
    fun `first plan schedules the future and cancels nothing`() {
        val now = 1_000L
        val derived = listOf(
            ReminderToSchedule("rpt_a_2026-06-16", "A", 2_000L, false),
            ReminderToSchedule("rpt_a_2026-06-15", "A", 500L, false),
        )
        val plan = planRepeatReminderSlots(null, derived, now)
        assertEquals(emptySet<String>(), plan.toCancel)
        assertEquals(listOf("rpt_a_2026-06-16"), plan.toSchedule.map { it.taskId })
        assertEquals(2_000L, plan.slots["rpt_a_2026-06-16"])
    }

    @Test
    fun `later plan cancels a slot that moved and keeps one that did not`() {
        val now = 1_000L
        val previous = mapOf("rpt_a_2026-06-16" to 2_000L, "rpt_a_2026-06-17" to 3_000L)
        val derived = listOf(
            ReminderToSchedule("rpt_a_2026-06-16", "A", 2_500L, false),
            ReminderToSchedule("rpt_a_2026-06-17", "A", 3_000L, false),
        )
        val plan = planRepeatReminderSlots(previous, derived, now)
        assertEquals(setOf("rpt_a_2026-06-16"), plan.toCancel)
        assertEquals(listOf("rpt_a_2026-06-16"), plan.toSchedule.map { it.taskId })
    }

    @Test
    fun `a day on or before last creation is a live instance`() {
        val zone = TimeZone.getTimeZone("UTC")
        val state = RepeatCfgSyncState(
            listOf(RepeatCfg(id = "cfg", isComplete = true, lastTaskCreationDay = "2026-06-16")),
        )
        assertTrue(isLiveRepeatInstance("rpt_cfg_2026-06-16", state, zone))
        assertEquals(false, isLiveRepeatInstance("rpt_cfg_2026-06-17", state, zone))
        assertEquals(false, isLiveRepeatInstance("task-1", state, zone))
    }

    @Test
    fun `occurrence ids keep underscores inside the config id`() {
        val parsed = parseRepeatOccurrenceId("rpt_cfg_a_2026-06-16")
        assertEquals("cfg_a", parsed?.cfgId)
        assertEquals("2026-06-16", parsed?.day)
        assertNull(parseRepeatOccurrenceId("task-1"))
    }
}

private fun JSONArray.toCfgList(): List<RepeatCfg> {
    val out = ArrayList<RepeatCfg>(length())
    for (i in 0 until length()) {
        out.add(RepeatCfg.fromJson(getJSONObject(i), complete = true)!!)
    }
    return out
}

private fun JSONArray.toStringSet(): Set<String> {
    val out = HashSet<String>()
    for (i in 0 until length()) out.add(getString(i))
    return out
}
