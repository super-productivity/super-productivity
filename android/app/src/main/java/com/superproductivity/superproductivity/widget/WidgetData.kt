package com.superproductivity.superproductivity.widget

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale

data class WidgetTask(
    val id: String,
    val title: String,
    val isDone: Boolean,
    val projectColor: String?
)

/**
 * When the snapshot stops describing "today", and which day it describes.
 *
 * Both are null for blobs written before the stamp existed (an install that upgraded
 * without opening the app yet) and for unsupported versions. They are deliberately
 * independent: a [validUntil] we cannot trust must never be paired with a [dayStr] we
 * can, or vice versa — [WidgetData.isSnapshotStale] returns false without a
 * [validUntil], and callers keep the pre-#9098 behaviour of trusting the list, which
 * self-heals on the next push.
 */
data class WidgetMeta(
    val dayStr: String?,
    val validUntil: Long?
)

/**
 * What the header should say. Decided purely from the stamp by [WidgetData.headerFor] so
 * the #9098 verdict is unit-testable — rendering it needs a Context, and this project has
 * no Robolectric, so a decision left inside the provider could ship inverted and green.
 */
sealed interface WidgetHeader {
    /** The snapshot still describes the current day. */
    data object Today : WidgetHeader

    /**
     * The snapshot has expired. [dayMs] is an instant on the day it describes (local
     * midnight, or 01:00 in zones where that midnight does not exist — either way the
     * right calendar day, which is all the label needs), or null when that day is
     * missing or unparseable: the header must still not say "Today", so it says only
     * that it is outdated.
     */
    data class Outdated(val dayMs: Long?) : WidgetHeader
}

/**
 * Native end of the `widget_data` KeyValStore contract. The writer is Angular's
 * WidgetDataService; the blob shape is defined by AndroidWidgetData in
 * src/app/features/android/android-widget.model.ts — keep both ends in sync and
 * bump `v` on breaking changes.
 */
object WidgetData {
    const val KEYVAL_KEY = "widget_data"
    private const val SUPPORTED_VERSION = 1
    private const val DAY_STR_PATTERN = "yyyy-MM-dd"

    /**
     * @param pendingDoneTargets per-task done-state targets queued via
     * [WidgetDoneQueue] but not yet applied by Angular — overlaid so a checkbox
     * tap is reflected immediately even while the app process is dead.
     */
    fun parse(
        json: String,
        pendingDoneTargets: Map<String, Boolean> = emptyMap()
    ): List<WidgetTask> {
        val root = JSONObject(json)
        if (root.optInt("v", -1) != SUPPORTED_VERSION) {
            return emptyList()
        }
        val tasksArray = root.optJSONArray("tasks") ?: return emptyList()
        val projectColors = root.optJSONObject("projectColors")
        val result = mutableListOf<WidgetTask>()
        for (i in 0 until tasksArray.length()) {
            val task = tasksArray.getJSONObject(i)
            val id = task.getString("id")
            // isNull guard: optString maps JSON null to the literal string "null"
            val projectId =
                if (task.isNull("projectId")) null else task.optString("projectId", null)
            val color = projectId?.let { pId ->
                projectColors?.takeIf { !it.isNull(pId) }?.optString(pId, null)
            }
            result.add(
                WidgetTask(
                    id = id,
                    title = task.getString("title"),
                    isDone = pendingDoneTargets[id] ?: task.optBoolean("isDone", false),
                    projectColor = color
                )
            )
        }
        return result
    }

    /**
     * Reads only the staleness stamp — the task list is loaded separately, in the
     * RemoteViewsFactory, while the header lives in the provider's RemoteViews.
     *
     * Every field degrades independently to null rather than to a plausible-looking
     * default: a defaulted stamp is indistinguishable from a real one and would make
     * the widget assert a verdict it cannot support.
     */
    fun parseMeta(json: String): WidgetMeta {
        return try {
            val root = JSONObject(json)
            if (root.optInt("v", -1) != SUPPORTED_VERSION) {
                WidgetMeta(null, null)
            } else {
                WidgetMeta(
                    // isNull guard because Android's optString maps JSON null to the
                    // string "null" (the reference org.json this is tested against does
                    // not, so no test can see the difference). Belt-and-braces: without
                    // it "null" would simply fail dayStrToMs and still yield Outdated.
                    dayStr = if (root.isNull("dayStr")) null
                    else root.optString("dayStr").takeIf { it.isNotEmpty() },
                    // takeIf, not optLong's default: absent and JSON-null both yield 0L,
                    // which is a real instant (1970) and would read as "expired long ago".
                    // Missing must mean unknown.
                    validUntil = root.optLong("validUntil", 0L).takeIf { it > 0L }
                )
            }
        } catch (e: Exception) {
            WidgetMeta(null, null)
        }
    }

    /**
     * The entire staleness verdict: has the snapshot outlived the day it describes?
     *
     * Angular ships the boundary instant, so no calendar rules are mirrored here — see
     * AndroidWidgetData.validUntil. Without a usable stamp we cannot know, and an
     * unknown day must not be reported as expired: the rows are still the best we have.
     */
    fun isSnapshotStale(meta: WidgetMeta, nowMs: Long): Boolean =
        meta.validUntil != null && nowMs >= meta.validUntil

    /**
     * The whole #9098 decision, Context-free so it can be tested: which header does this
     * stamp justify? A stale snapshot whose day we cannot read still must not be called
     * "Today" — losing the label is not a licence to lie.
     */
    fun headerFor(meta: WidgetMeta, nowMs: Long): WidgetHeader =
        if (!isSnapshotStale(meta, nowMs)) WidgetHeader.Today
        else WidgetHeader.Outdated(meta.dayStr?.let { dayStrToMs(it) })

    /**
     * Local-midnight epoch millis for a YYYY-MM-DD day stamp, or null if it is not
     * exactly that. Feeds the header LABEL only, never the verdict.
     *
     * Strict on purpose: SimpleDateFormat is lenient by default, so "2026-02-30" would
     * roll into March and "2026-07-17garbage" would parse as a prefix — both would show
     * a confidently wrong day. Locale.US pins the Gregorian calendar and ASCII digits;
     * the device default could be a Buddhist or Persian calendar and misread the stamp.
     */
    fun dayStrToMs(dayStr: String): Long? = try {
        val fmt = SimpleDateFormat(DAY_STR_PATTERN, Locale.US).apply { isLenient = false }
        fmt.parse(dayStr)?.takeIf { fmt.format(it) == dayStr }?.time
    } catch (e: Exception) {
        null
    }
}
