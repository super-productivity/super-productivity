package com.superproductivity.superproductivity.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Locks the native end of the `widget_data` v:1 contract. The writer-side shape is
 * locked by android-widget.selectors.spec.ts — if one changes, the other must too.
 */
class WidgetDataTest {

    // validUntil is what the writer really emits for dayStr 2026-07-17 with a 0 offset in
    // Europe/Berlin: 2026-07-17T22:00Z == local midnight starting the 18th. Deriving it
    // rather than inventing one keeps the fixture a blob the app could actually produce.
    private val blob =
        """
        {
          "v": 1,
          "dayStr": "2026-07-17",
          "validUntil": 1784325600000,
          "tasks": [
            {"id": "t1", "title": "Task one", "isDone": false, "projectId": "p1"},
            {"id": "t2", "title": "Task two", "isDone": true},
            {"id": "t3", "title": "Task three", "isDone": false, "projectId": null}
          ],
          "projectColors": {"p1": "#ff0000"}
        }
        """.trimIndent()

    @Test
    fun parsesTasksWithProjectColors() {
        val tasks = WidgetData.parse(blob)
        assertEquals(3, tasks.size)
        assertEquals(WidgetTask("t1", "Task one", false, "#ff0000"), tasks[0])
        assertEquals(WidgetTask("t2", "Task two", true, null), tasks[1])
    }

    @Test
    fun jsonNullProjectIdDoesNotBecomeStringNull() {
        // org.json's optString maps JSON null to the literal string "null"
        val tasks = WidgetData.parse(blob)
        assertNull(tasks[2].projectColor)
    }

    @Test
    fun overlaysPendingDoneTargets() {
        val tasks = WidgetData.parse(blob, pendingDoneTargets = mapOf("t1" to true))
        assertTrue(tasks[0].isDone)
        assertTrue(tasks[1].isDone)
        assertEquals(false, tasks[2].isDone)
    }

    @Test
    fun overlaysPendingUndoneTargets() {
        // t2 is done in the blob but has a pending "mark undone" tap
        val tasks = WidgetData.parse(blob, pendingDoneTargets = mapOf("t2" to false))
        assertEquals(false, tasks[1].isDone)
    }

    @Test
    fun unknownVersionParsesToEmpty() {
        assertTrue(WidgetData.parse("""{"v": 2, "tasks": [{"id": "x"}]}""").isEmpty())
        assertTrue(WidgetData.parse("""{"tasks": []}""").isEmpty())
    }

    @Test
    fun emptyBlobParsesToEmpty() {
        assertTrue(WidgetData.parse("{}").isEmpty())
        assertTrue(WidgetData.parse("""{"v": 1}""").isEmpty())
    }

    @Test
    fun missingColorFallsBackToNull() {
        val json =
            """{"v":1,"tasks":[{"id":"a","title":"A","isDone":false,"projectId":"px"}],"projectColors":{}}"""
        assertNull(WidgetData.parse(json)[0].projectColor)
    }

    @Test
    fun parsesStalenessStamp() {
        val meta = WidgetData.parseMeta(blob)
        assertEquals("2026-07-17", meta.dayStr)
        assertEquals(1784325600000L, meta.validUntil)
    }

    // --- the verdict itself: this IS the #9098 fix ---

    @Test
    fun snapshotIsFreshBeforeItsBoundary() {
        val meta = WidgetMeta(dayStr = "2026-07-17", validUntil = 1_000L)
        assertEquals(false, WidgetData.isSnapshotStale(meta, 999L))
    }

    @Test
    fun snapshotIsStaleAtAndAfterItsBoundary() {
        val meta = WidgetMeta(dayStr = "2026-07-17", validUntil = 1_000L)
        // boundary is inclusive: validUntil is the first instant of the NEXT day
        assertTrue(WidgetData.isSnapshotStale(meta, 1_000L))
        assertTrue(WidgetData.isSnapshotStale(meta, 1_001L))
    }

    @Test
    fun snapshotWithoutBoundaryIsNeverStale() {
        // Legacy blob (pre-#9098) or a rejected stamp: we cannot know, so we must not
        // claim expiry — the rows are still the best we have, as before the fix.
        assertEquals(
            false,
            WidgetData.isSnapshotStale(WidgetMeta("2026-07-17", null), Long.MAX_VALUE)
        )
    }

    // --- headerFor: the decision the whole fix exists to make ---

    @Test
    fun freshSnapshotHeaderIsToday() {
        val header = WidgetData.headerFor(WidgetMeta("2026-07-17", 1_000L), 999L)
        assertEquals(WidgetHeader.Today, header)
    }

    @Test
    fun staleSnapshotHeaderIsOutdatedWithItsOwnDay() {
        // Inverting the staleness check would make this the Today branch and vice versa.
        // The expected day is built independently of dayStrToMs (the function under test),
        // so a globally-shifted dayStrToMs cannot drag both sides along with it.
        val expectedDay = Calendar.getInstance().apply {
            clear()
            set(2026, Calendar.JULY, 17)
        }.timeInMillis
        val header = WidgetData.headerFor(WidgetMeta("2026-07-17", 1_000L), 1_000L)
        assertEquals(WidgetHeader.Outdated(expectedDay), header)
    }

    @Test
    fun staleSnapshotWithoutDayIsStillOutdated() {
        // Losing the label is not a licence to say "Today" — the snapshot IS expired.
        assertEquals(
            WidgetHeader.Outdated(null),
            WidgetData.headerFor(WidgetMeta(null, 1_000L), 1_000L)
        )
    }

    @Test
    fun staleSnapshotWithUnparseableDayIsStillOutdated() {
        assertEquals(
            WidgetHeader.Outdated(null),
            WidgetData.headerFor(WidgetMeta("2026-02-30", 1_000L), 1_000L)
        )
    }

    @Test
    fun legacyBlobHeaderIsTodayNotOutdated() {
        // A pre-#9098 blob carries no boundary: keep the old behaviour rather than
        // label every widget outdated on upgrade.
        assertEquals(
            WidgetHeader.Today,
            WidgetData.headerFor(WidgetMeta("2026-07-17", null), Long.MAX_VALUE)
        )
    }

    // --- parseMeta degrades to null, never to a plausible default ---

    @Test
    fun blobWithoutStampHasNullFields() {
        // Written before the stamp existed: an install that upgraded but has not
        // re-pushed yet.
        val meta = WidgetData.parseMeta("""{"v":1,"tasks":[]}""")
        assertNull(meta.dayStr)
        assertNull(meta.validUntil)
    }

    @Test
    fun keyValStoreDefaultBlobHasNullFields() {
        // "{}" is KeyValStore.get's default when no blob was ever written.
        val meta = WidgetData.parseMeta("{}")
        assertNull(meta.dayStr)
        assertNull(meta.validUntil)
    }

    @Test
    fun unparseableBlobDegradesInsteadOfThrowing() {
        // parseMeta runs while building the header RemoteViews — a throw there would
        // take down the whole widget render.
        assertNull(WidgetData.parseMeta("not json").validUntil)
    }

    @Test
    fun unsupportedVersionYieldsNoStamp() {
        // Assert dayStr too: a v:2 fixture carries no validUntil anyway, so asserting
        // only that would pass with the version guard deleted.
        val meta = WidgetData.parseMeta("""{"v":2,"dayStr":"2026-07-17","validUntil":1784325600000}""")
        assertNull(meta.dayStr)
        assertNull(meta.validUntil)
    }

    @Test
    fun jsonNullStampFieldsBecomeNullNotDefaults() {
        // Pins the validUntil side: drop the `takeIf { it > 0L }` and this fails, because
        // a JSON-null stamp would parse to 0L — a 1970 instant reading as "expired".
        //
        // CAVEAT (measured, not assumed): it does NOT pin the dayStr isNull guard. This
        // classpath has the REFERENCE org.json, whose optString returns the default for
        // JSON null; Android's returns the literal string "null". Deleting that guard
        // leaves this green. It stays because Android needs it — not because a test
        // proves it.
        val meta = WidgetData.parseMeta("""{"v":1,"dayStr":null,"validUntil":null,"tasks":[]}""")
        assertNull(meta.dayStr)
        assertNull(meta.validUntil)
        assertEquals(false, WidgetData.isSnapshotStale(meta, Long.MAX_VALUE))
    }

    @Test
    fun nonPositiveValidUntilIsRejected() {
        // 0L is both optLong's default and a real instant; treat it as absent.
        assertNull(WidgetData.parseMeta("""{"v":1,"validUntil":0,"tasks":[]}""").validUntil)
    }

    // --- dayStrToMs feeds the LABEL only, and is strict ---

    @Test
    fun dayStrToMsIgnoresANonGregorianDeviceCalendar() {
        // The round-trip guard CANNOT catch this: a Buddhist-calendar default locale
        // reads "2026" as a Buddhist year (Gregorian 1483) and formats it back to the
        // identical string, so only the pinned Locale.US keeps the day right. Without it
        // the header reads "17 Jul 1483 (outdated)".
        val prev = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("th-TH-u-ca-buddhist"))
            val ms = WidgetData.dayStrToMs("2026-07-17")
            assertNotNull(ms)
            assertEquals(
                "2026-07-17",
                SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ms!!))
            )
        } finally {
            Locale.setDefault(prev)
        }
    }

    @Test
    fun dayStrToMsRoundTripsToTheSameLocalDay() {
        val ms = WidgetData.dayStrToMs("2026-07-16")
        assertNotNull(ms)
        assertEquals("2026-07-16", SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(ms!!)))
    }

    @Test
    fun dayStrToMsRejectsGarbageInsteadOfRollingOver() {
        assertNull(WidgetData.dayStrToMs("nope"))
        assertNull(WidgetData.dayStrToMs(""))
        // Both of these are caught by the format round-trip, which is the load-bearing
        // guard; isLenient=false is belt-and-braces. Without the round-trip a lenient
        // parse rolls "2026-02-30" into March and accepts the "2026-07-17" prefix of
        // the last case — either way labelling a confidently wrong day.
        assertNull(WidgetData.dayStrToMs("2026-02-30"))
        assertNull(WidgetData.dayStrToMs("2026-07-17garbage"))
    }
}
