package com.superproductivity.superproductivity.service

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

/**
 * The Kotlin port of getUpcomingRepeatReminders must match the timestamps
 * tools/generate-repeat-reminder-fixtures.mjs produced from that function.
 * Each case's configs arrive as the app's own snapshot
 * (getRepeatCfgSnapshotForNative), so the bridge format is covered too.
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
            val snapshot = entry.getJSONObject("snapshot")
            val parsed = RepeatReminderCache.parseAppSnapshot(snapshot.toString())
                ?: error("$name: snapshot unreadable")
            // A config the parser drops would vanish silently in no-reminder cases.
            assertEquals("$name: cfgs parsed", snapshot.getJSONArray("cfgs").length(), parsed.cfgs.size)
            // The worker reads the stored copy, so a field lost on save must fail too.
            val state = RepeatReminderCache.decodeState(RepeatReminderCache.encodeState(parsed))
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
        val plan = planRepeatReminderSlots(null, derived, now, emptyMap())
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
        val plan = planRepeatReminderSlots(previous, derived, now, emptyMap())
        assertEquals(setOf("rpt_a_2026-06-16"), plan.toCancel)
        assertEquals(listOf("rpt_a_2026-06-16"), plan.toSchedule.map { it.taskId })
    }

    @Test
    fun `later plan leaves a slot that already fired, so its notification stays`() {
        val now = 10_000L
        val previous = mapOf("rpt_a_2026-06-16" to 9_000L, "rpt_a_2026-06-17" to 20_000L)
        val derived = listOf(ReminderToSchedule("rpt_a_2026-06-17", "A", 20_000L, false))
        val plan = planRepeatReminderSlots(previous, derived, now, emptyMap())
        assertEquals(emptySet<String>(), plan.toCancel)
        assertEquals(emptyList<String>(), plan.toSchedule.map { it.taskId })
    }

    @Test
    fun `later plan re-arms a fired slot whose occurrence moved to a later time`() {
        val now = 10_000L
        val previous = mapOf("rpt_a_2026-06-16" to 9_000L)
        val derived = listOf(ReminderToSchedule("rpt_a_2026-06-16", "A", 20_000L, false))
        val plan = planRepeatReminderSlots(previous, derived, now, emptyMap())
        assertEquals(setOf("rpt_a_2026-06-16"), plan.toCancel)
        assertEquals(listOf("rpt_a_2026-06-16"), plan.toSchedule.map { it.taskId })
    }

    @Test
    fun `later plan re-arms a pending slot whose title changed`() {
        val now = 1_000L
        val previous = mapOf("rpt_a_2026-06-16" to 2_000L, "rpt_a_2026-06-17" to 3_000L)
        val derived = listOf(
            ReminderToSchedule("rpt_a_2026-06-16", "Renamed", 2_000L, false),
            ReminderToSchedule("rpt_a_2026-06-17", "Renamed", 3_000L, false),
        )
        val armedTitles = mapOf("rpt_a_2026-06-16" to "Old", "rpt_a_2026-06-17" to "Renamed")
        val plan = planRepeatReminderSlots(previous, derived, now, armedTitles)
        assertEquals(emptySet<String>(), plan.toCancel)
        assertEquals(listOf("rpt_a_2026-06-16"), plan.toSchedule.map { it.taskId })
    }

    @Test
    fun `later plan cancels a future slot that is no longer derived`() {
        val now = 10_000L
        val previous = mapOf("rpt_a_2026-06-17" to 20_000L)
        val plan = planRepeatReminderSlots(previous, emptyList(), now, emptyMap())
        assertEquals(setOf("rpt_a_2026-06-17"), plan.toCancel)
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
    fun `occurrence ids use ASCII digits on a Persian-locale device`() {
        assertFirstIdUnderLocale("fa-IR")
    }

    @Test
    fun `occurrence ids use Gregorian years on a Thai-locale device`() {
        assertFirstIdUnderLocale("th-TH")
    }

    private fun assertFirstIdUnderLocale(tag: String) {
        val previous = Locale.getDefault()
        Locale.setDefault(Locale.forLanguageTag(tag))
        try {
            val state = RepeatCfgSyncState(
                listOf(
                    RepeatCfg(
                        id = "cfg",
                        isComplete = true,
                        repeatCycle = "DAILY",
                        repeatEvery = 1,
                        startDate = "2026-01-01",
                        startTime = "09:00",
                        remindAt = "AtStart",
                        lastTaskCreationDay = "2026-06-15",
                    ),
                ),
            )
            val got = upcomingRepeatReminders(
                state,
                now = 1_781_535_600_000L, // 2026-06-15T15:00:00Z
                zone = TimeZone.getTimeZone("UTC"),
                startOfNextDayDiffMs = 0L,
            )
            assertEquals("rpt_cfg_2026-06-16", got.first().taskId)
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test
    fun `occurrence ids keep underscores inside the config id`() {
        val parsed = parseRepeatOccurrenceId("rpt_cfg_a_2026-06-16")
        assertEquals("cfg_a", parsed?.cfgId)
        assertEquals("2026-06-16", parsed?.day)
        assertNull(parseRepeatOccurrenceId("task-1"))
    }
}
