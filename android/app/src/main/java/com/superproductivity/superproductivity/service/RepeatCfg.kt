package com.superproductivity.superproductivity.service

import org.json.JSONArray
import org.json.JSONObject

/**
 * Schedule fields of a task repeat config. Notes and subtask templates are
 * never stored: the background worker only needs enough to arm an alarm.
 *
 * [isComplete] is false when this phone has seen only a partial update and
 * not the config itself. Those are not armed — a wrong guess would ring at
 * the wrong time. A later snapshot (create, file read, LWW replace) fills it in.
 */
data class RepeatCfg(
    val id: String,
    val title: String = "",
    val projectId: String? = null,
    /** Needed so a tag delete can drop a config that had only that tag (tag-shared.reducer.ts). */
    val tagIds: List<String> = emptyList(),
    val lastTaskCreation: Long? = null,
    val lastTaskCreationDay: String? = null,
    val startTime: String? = null,
    val remindAt: String? = null,
    val isPaused: Boolean = false,
    val repeatCycle: String = "",
    val startDate: String? = null,
    val repeatUntilDay: String? = null,
    val repeatEvery: Int = 0,
    val sunday: Boolean = false,
    val monday: Boolean = false,
    val tuesday: Boolean = false,
    val wednesday: Boolean = false,
    val thursday: Boolean = false,
    val friday: Boolean = false,
    val saturday: Boolean = false,
    val monthlyWeekOfMonth: Int? = null,
    val monthlyWeekday: Int? = null,
    val monthlyLastDay: Boolean = false,
    val repeatFromCompletionDate: Boolean = false,
    val waitForCompletion: Boolean = false,
    val deletedInstanceDates: List<String> = emptyList(),
    val isComplete: Boolean = false,
) {
    fun weekdaySunday0(day: Int): Boolean = when (day) {
        0 -> sunday
        1 -> monday
        2 -> tuesday
        3 -> wednesday
        4 -> thursday
        5 -> friday
        6 -> saturday
        else -> false
    }

    /** Enough of a schedule to ask the occurrence rules anything. */
    fun isArmable(): Boolean =
        isComplete &&
            !isPaused &&
            !waitForCompletion &&
            isValidSplitTime(startTime) &&
            hasRemindOption(remindAt) &&
            repeatEvery >= 1 &&
            repeatCycle in REPEAT_CYCLES

    fun applyChanges(changes: JSONObject, cleared: Set<String>): RepeatCfg {
        fun clearedOrNull(key: String): Boolean = key in cleared || (changes.has(key) && changes.isNull(key))
        var next = this
        if (changes.has("title") || "title" in cleared) {
            next = next.copy(title = if (clearedOrNull("title")) "" else changes.optString("title", ""))
        }
        if (changes.has("projectId") || "projectId" in cleared) {
            next = next.copy(projectId = if (clearedOrNull("projectId")) null else changes.optString("projectId", "").ifEmpty { null })
        }
        if (changes.has("tagIds") || "tagIds" in cleared) {
            next = next.copy(tagIds = if (clearedOrNull("tagIds")) emptyList() else readIds(changes.optJSONArray("tagIds")))
        }
        if (changes.has("lastTaskCreation") || "lastTaskCreation" in cleared) {
            next = next.copy(lastTaskCreation = if (clearedOrNull("lastTaskCreation")) null else positiveLong(changes, "lastTaskCreation"))
        }
        if (changes.has("lastTaskCreationDay") || "lastTaskCreationDay" in cleared) {
            next = next.copy(lastTaskCreationDay = if (clearedOrNull("lastTaskCreationDay")) null else dateOrNull(changes.optString("lastTaskCreationDay", "")))
        }
        if (changes.has("startTime") || "startTime" in cleared) {
            next = next.copy(startTime = if (clearedOrNull("startTime")) null else changes.optString("startTime", "").ifEmpty { null })
        }
        if (changes.has("remindAt") || "remindAt" in cleared) {
            next = next.copy(remindAt = if (clearedOrNull("remindAt")) null else changes.optString("remindAt", "").ifEmpty { null })
        }
        if (changes.has("isPaused") && !changes.isNull("isPaused")) {
            next = next.copy(isPaused = changes.optBoolean("isPaused", false))
        } else if ("isPaused" in cleared) {
            next = next.copy(isPaused = false)
        }
        if (changes.has("repeatCycle") || "repeatCycle" in cleared) {
            next = next.copy(repeatCycle = if (clearedOrNull("repeatCycle")) "" else changes.optString("repeatCycle", ""))
        }
        if (changes.has("startDate") || "startDate" in cleared) {
            next = next.copy(startDate = if (clearedOrNull("startDate")) null else dateOrNull(changes.optString("startDate", "")))
        }
        if (changes.has("repeatUntilDay") || "repeatUntilDay" in cleared) {
            next = next.copy(repeatUntilDay = if (clearedOrNull("repeatUntilDay")) null else dateOrNull(changes.optString("repeatUntilDay", "")))
        }
        if (changes.has("repeatEvery") || "repeatEvery" in cleared) {
            next = next.copy(repeatEvery = if (clearedOrNull("repeatEvery")) 0 else wholeRepeatEvery(changes))
        }
        next = next.copy(
            sunday = boolField(changes, cleared, "sunday", next.sunday),
            monday = boolField(changes, cleared, "monday", next.monday),
            tuesday = boolField(changes, cleared, "tuesday", next.tuesday),
            wednesday = boolField(changes, cleared, "wednesday", next.wednesday),
            thursday = boolField(changes, cleared, "thursday", next.thursday),
            friday = boolField(changes, cleared, "friday", next.friday),
            saturday = boolField(changes, cleared, "saturday", next.saturday),
        )
        if (changes.has("monthlyWeekOfMonth") || "monthlyWeekOfMonth" in cleared) {
            next = next.copy(monthlyWeekOfMonth = if (clearedOrNull("monthlyWeekOfMonth")) null else intOrNull(changes, "monthlyWeekOfMonth"))
        }
        if (changes.has("monthlyWeekday") || "monthlyWeekday" in cleared) {
            next = next.copy(monthlyWeekday = if (clearedOrNull("monthlyWeekday")) null else intOrNull(changes, "monthlyWeekday"))
        }
        if (changes.has("monthlyLastDay") && !changes.isNull("monthlyLastDay")) {
            next = next.copy(monthlyLastDay = changes.optBoolean("monthlyLastDay", false))
        } else if ("monthlyLastDay" in cleared) {
            next = next.copy(monthlyLastDay = false)
        }
        if (changes.has("repeatFromCompletionDate") && !changes.isNull("repeatFromCompletionDate")) {
            next = next.copy(repeatFromCompletionDate = changes.optBoolean("repeatFromCompletionDate", false))
        } else if ("repeatFromCompletionDate" in cleared) {
            next = next.copy(repeatFromCompletionDate = false)
        }
        if (changes.has("waitForCompletion") && !changes.isNull("waitForCompletion")) {
            next = next.copy(waitForCompletion = changes.optBoolean("waitForCompletion", false))
        } else if ("waitForCompletion" in cleared) {
            next = next.copy(waitForCompletion = false)
        }
        if (changes.has("deletedInstanceDates") || "deletedInstanceDates" in cleared) {
            next = next.copy(
                deletedInstanceDates = if (clearedOrNull("deletedInstanceDates")) emptyList()
                else readDeletedDates(changes.optJSONArray("deletedInstanceDates")),
            )
        }
        return next
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("projectId", projectId ?: JSONObject.NULL)
        put("tagIds", JSONArray(tagIds))
        put("lastTaskCreation", lastTaskCreation ?: JSONObject.NULL)
        put("lastTaskCreationDay", lastTaskCreationDay ?: JSONObject.NULL)
        put("startTime", startTime ?: JSONObject.NULL)
        put("remindAt", remindAt ?: JSONObject.NULL)
        put("isPaused", isPaused)
        put("repeatCycle", repeatCycle)
        put("startDate", startDate ?: JSONObject.NULL)
        put("repeatUntilDay", repeatUntilDay ?: JSONObject.NULL)
        put("repeatEvery", repeatEvery)
        put("sunday", sunday)
        put("monday", monday)
        put("tuesday", tuesday)
        put("wednesday", wednesday)
        put("thursday", thursday)
        put("friday", friday)
        put("saturday", saturday)
        put("monthlyWeekOfMonth", monthlyWeekOfMonth ?: JSONObject.NULL)
        put("monthlyWeekday", monthlyWeekday ?: JSONObject.NULL)
        put("monthlyLastDay", monthlyLastDay)
        put("repeatFromCompletionDate", repeatFromCompletionDate)
        put("waitForCompletion", waitForCompletion)
        put("deletedInstanceDates", JSONArray(deletedInstanceDates))
        put("isComplete", isComplete)
    }

    companion object {
        fun fromJson(obj: JSONObject, complete: Boolean): RepeatCfg? {
            val id = obj.optString("id", "")
            if (id.isEmpty() || id.length > 200) return null
            val resolvedComplete = if (obj.has("isComplete") && !obj.isNull("isComplete")) {
                obj.optBoolean("isComplete", complete)
            } else {
                complete
            }
            return RepeatCfg(id = id).applyChanges(obj, emptySet()).copy(isComplete = resolvedComplete)
        }
    }
}

data class RepeatCfgSyncState(
    val cfgs: List<RepeatCfg> = emptyList(),
    val archivedProjectIds: Set<String> = emptySet(),
) {
    fun byId(id: String): RepeatCfg? = cfgs.firstOrNull { it.id == id }

    fun upsert(cfg: RepeatCfg): RepeatCfgSyncState {
        val idx = cfgs.indexOfFirst { it.id == cfg.id }
        if (idx < 0) return copy(cfgs = cfgs + cfg)
        val next = cfgs.toMutableList()
        next[idx] = cfg
        return copy(cfgs = next)
    }

    /** Mirrors cleanupTaskRepeatCfgsForProject: every config of the project goes. */
    fun deleteProject(id: String, removed: MutableSet<String>): RepeatCfgSyncState {
        val gone = cfgs.filter { it.projectId == id }
        gone.forEach { removed.add(it.id) }
        return copy(cfgs = cfgs - gone.toSet(), archivedProjectIds = archivedProjectIds - id)
    }

    /** Mirrors tag-shared.reducer.ts cleanupTaskRepeatCfgs: orphaned configs go, the rest lose the tags. */
    fun deleteTags(tagIds: Set<String>, removed: MutableSet<String>): RepeatCfgSyncState {
        val next = cfgs.mapNotNull { cfg ->
            if (cfg.tagIds.none { it in tagIds }) return@mapNotNull cfg
            val remaining = cfg.tagIds.filter { it !in tagIds }
            if (remaining.isEmpty() && cfg.projectId == null) {
                removed.add(cfg.id)
                null
            } else {
                cfg.copy(tagIds = remaining)
            }
        }
        return copy(cfgs = next)
    }

    fun remove(id: String): RepeatCfgSyncState = copy(cfgs = cfgs.filter { it.id != id })

    fun archive(id: String): RepeatCfgSyncState =
        if (id.isEmpty()) this else copy(archivedProjectIds = archivedProjectIds + id)

    fun unarchive(id: String): RepeatCfgSyncState =
        copy(archivedProjectIds = archivedProjectIds - id)

    companion object {
        val EMPTY = RepeatCfgSyncState()
    }
}

private val REPEAT_CYCLES = setOf("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
private val DATE_STR = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private const val MAX_DELETED_DATES = 400

internal fun hasRemindOption(remindAt: String?): Boolean =
    remindAt != null && remindAt.isNotEmpty() && remindAt != "DoNotRemind"

internal fun isValidSplitTime(v: String?): Boolean {
    if (v == null || v.length > 5) return false
    val split = v.split(':')
    if (split.size != 2) return false
    val hour = split[0].toIntOrNull() ?: return false
    val minute = split[1].toIntOrNull() ?: return false
    return hour in 0..24 && minute in 0..59
}

private fun boolField(changes: JSONObject, cleared: Set<String>, key: String, current: Boolean): Boolean {
    if (key in cleared || (changes.has(key) && changes.isNull(key))) return false
    if (changes.has(key) && changes.opt(key) is Boolean) return changes.optBoolean(key)
    return current
}

private fun positiveLong(obj: JSONObject, key: String): Long? {
    if (!obj.has(key) || obj.isNull(key)) return null
    val n = obj.optDouble(key, Double.NaN)
    if (!n.isFinite() || n <= 0.0 || n > Long.MAX_VALUE.toDouble()) return null
    return n.toLong()
}

private fun intOrNull(obj: JSONObject, key: String): Int? {
    val n = obj.optDouble(key, Double.NaN)
    if (!n.isFinite() || n % 1.0 != 0.0 || n < Int.MIN_VALUE.toDouble() || n > Int.MAX_VALUE.toDouble()) return null
    return n.toInt()
}

private fun wholeRepeatEvery(obj: JSONObject): Int {
    val n = intOrNull(obj, "repeatEvery") ?: return 0
    return if (n in 1..10_000) n else 0
}

private fun dateOrNull(value: String): String? = value.takeIf { DATE_STR.matches(it) }

private const val MAX_IDS = 200

private fun readIds(arr: JSONArray?): List<String> {
    if (arr == null) return emptyList()
    val out = ArrayList<String>(minOf(arr.length(), MAX_IDS))
    for (i in 0 until arr.length()) {
        if (out.size >= MAX_IDS) break
        val value = arr.optString(i, "")
        if (value.isNotEmpty() && value.length <= 200 && value !in out) out.add(value)
    }
    return out
}

private fun readDeletedDates(arr: JSONArray?): List<String> {
    if (arr == null) return emptyList()
    val out = ArrayList<String>(minOf(arr.length(), MAX_DELETED_DATES))
    for (i in 0 until arr.length()) {
        if (out.size >= MAX_DELETED_DATES) break
        val value = arr.optString(i, "")
        if (DATE_STR.matches(value) && value !in out) out.add(value)
    }
    return out
}
