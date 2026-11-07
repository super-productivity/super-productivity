package com.superproductivity.superproductivity.widget

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale

data class WidgetTask(
    val id: String,
    val title: String,
    val isDone: Boolean,
    val projectColor: String?,
    /** A quick add the app has not imported yet; it has no task to toggle. */
    val isPending: Boolean = false
)

/** A project a widget instance can be pointed at (#9518). */
data class WidgetProject(
    val id: String,
    val title: String
)

/** The task currently being tracked — on this device or, via SuperSync presence, a remote one. */
data class WidgetCurrentTask(
    val title: String,
    val deviceLabel: String
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
     * How long a queued "open this project" request from a widget tap stays valid.
     * A background launch that Android blocks fails silently, so without a deadline
     * the request would wait for the next app start, however much later, and open
     * the project unasked. A minute covers a slow cold start.
     */
    const val PROJECT_OPEN_REQUEST_TTL_MS = 60_000L

    /**
     * @param pendingDoneTargets per-task done-state targets queued via
     * [WidgetDoneQueue] but not yet applied by Angular — overlaid so a checkbox
     * tap is reflected immediately even while the app process is dead.
     * @param selectedProjectId the project this widget instance shows, or null for
     * Today. An id missing from the snapshot (deleted, archived or hidden project,
     * or a blob written before `projects` existed) falls back to Today.
     */
    fun parse(
        json: String,
        pendingDoneTargets: Map<String, Boolean> = emptyMap(),
        selectedProjectId: String? = null
    ): List<WidgetTask> {
        val root = JSONObject(json)
        if (root.optInt("v", -1) != SUPPORTED_VERSION) {
            return emptyList()
        }
        // Project lists hold open tasks only (Angular leaves done ones out), so a
        // checked row there shows only until the next push applies the tap.
        val tasksArray = selectedProjectId
            ?.let { usableProject(root, it) }
            ?.optJSONArray("tasks")
            ?: root.optJSONArray("tasks")
            ?: return emptyList()
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

    /** The projects the snapshot offers for the widget's project picker. */
    fun parseProjects(json: String): List<WidgetProject> {
        val root = JSONObject(json)
        if (root.optInt("v", -1) != SUPPORTED_VERSION) {
            return emptyList()
        }
        val projects = root.optJSONArray("projects") ?: return emptyList()
        return (0 until projects.length()).mapNotNull { i ->
            projects.getJSONObject(i).takeIf(::isUsableProject)?.let {
                WidgetProject(it.getString("id"), it.getString("title"))
            }
        }
    }

    /**
     * The header for a project widget, or null when [projectId] is not a usable
     * project in the snapshot — the same check [parse] uses, so header and rows
     * always fall back to Today together.
     */
    fun projectTitle(json: String, projectId: String): String? {
        val root = JSONObject(json)
        if (root.optInt("v", -1) != SUPPORTED_VERSION) {
            return null
        }
        return usableProject(root, projectId)?.getString("title")
    }

    /** Whether a project-open request queued at [queuedAtMs] may still be acted on. */
    fun isProjectOpenRequestFresh(queuedAtMs: Long, nowMs: Long): Boolean =
        queuedAtMs > 0L && nowMs >= queuedAtMs && nowMs - queuedAtMs < PROJECT_OPEN_REQUEST_TTL_MS

    private fun usableProject(root: JSONObject, projectId: String): JSONObject? {
        val projects = root.optJSONArray("projects") ?: return null
        return (0 until projects.length())
            .map { projects.getJSONObject(it) }
            .firstOrNull { !it.isNull("id") && it.optString("id") == projectId }
            ?.takeIf(::isUsableProject)
    }

    private fun isUsableProject(project: JSONObject): Boolean =
        !project.isNull("id") && project.optString("id").isNotEmpty() &&
            !project.isNull("title") && project.optString("title").isNotEmpty() &&
            project.optJSONArray("tasks") != null

    /**
     * Puts the title captures from [CaptureInbox.pendingJson] (widget quick adds)
     * above the snapshot, newest first like the add bar's add-to-top. Not a Today
     * rule mirrored natively: the app imports every title capture into Today by
     * contract (AndroidCaptureImportService). The capture id becomes the task id,
     * so one already in the snapshot (imported, not yet acknowledged) shows once.
     */
    fun withPendingCaptures(tasks: List<WidgetTask>, capturesJson: String): List<WidgetTask> {
        val known = tasks.mapTo(HashSet()) { it.id }
        val captures = JSONArray(capturesJson)
        val pending = (0 until captures.length())
            .map { captures.getJSONObject(it) }
            .filter { it.getString("id") !in known }
            .map {
                WidgetTask(
                    id = it.getString("id"),
                    title = it.getString("title"),
                    isDone = false,
                    projectColor = null,
                    isPending = true
                )
            }
        return pending.asReversed() + tasks
    }

    /**
     * The `currentTask` field, or null when nothing is tracked (locally or, via
     * SuperSync tracking-presence, remotely) — same degrade-to-null contract as
     * every other field here, never a title-less stub. Also null once the session's
     * `expiresAt` has passed at [nowMs].
     */
    fun parseCurrentTask(json: String, nowMs: Long): WidgetCurrentTask? {
        return try {
            val root = JSONObject(json)
            if (root.optInt("v", -1) != SUPPORTED_VERSION) {
                return null
            }
            val task = root.optJSONObject("currentTask") ?: return null
            // A remote session carries its own deadline: JS cannot expire it once the
            // process is gone, and a saved blob would otherwise read "tracking" forever.
            if (task.has("expiresAt") && nowMs >= task.getLong("expiresAt")) {
                return null
            }
            WidgetCurrentTask(
                title = task.getString("title"),
                deviceLabel = task.optString("deviceLabel", "")
            )
        } catch (e: Exception) {
            null
        }
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
