package com.superproductivity.superproductivity.service

import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.min

/**
 * Upcoming reminders for repeat configs, for the background worker.
 *
 * Line-by-line port of `getUpcomingRepeatReminders` and the date helpers it
 * calls (`getNewestPossibleDueDate`, `getRepeatDueWithTime`,
 * `remindOptionToMilliseconds`, and the recurrence utils under
 * `src/app/features/task-repeat-cfg/store/`). Those TypeScript helpers stay
 * the source of truth. This file is checked against
 * `repeat-reminder-fixtures.json`, which
 * `tools/generate-repeat-reminder-fixtures.mjs` regenerates from that
 * TypeScript. Do not change a rule here without regenerating the fixture and
 * keeping both sides green.
 *
 * Dates use the device zone, the same local calendar `Date` uses in the app.
 * Tests pass an explicit [TimeZone].
 */
internal const val REPEAT_LOOKAHEAD_DAYS = 14
internal const val REPEAT_MAX_SCHEDULED = 32

private const val DAY_MS = 86_400_000L
private const val MINUTE_MS = 60_000L
private val REPEAT_OCCURRENCE_ID = Regex("^rpt_(.+)_(\\d{4}-\\d{2}-\\d{2})$")

internal data class RepeatOccurrenceId(val cfgId: String, val day: String)

internal fun parseRepeatOccurrenceId(reminderId: String): RepeatOccurrenceId? {
    val match = REPEAT_OCCURRENCE_ID.matchEntire(reminderId) ?: return null
    return RepeatOccurrenceId(match.groupValues[1], match.groupValues[2])
}

internal data class RepeatSlotPlan(
    val toCancel: Set<String>,
    val toSchedule: List<ReminderToSchedule>,
    val slots: Map<String, Long>,
)

/**
 * Diffs derived repeat alarms against the ones this worker armed last time.
 * A null [previous] cancels nothing: alarms the app set for occurrences this
 * worker has never judged are not its to remove. [armedTitles] are the titles
 * the pending alarms will show; a renamed config re-arms them in place.
 */
internal fun planRepeatReminderSlots(
    previous: Map<String, Long>?,
    derived: List<ReminderToSchedule>,
    now: Long,
    armedTitles: Map<String, String>,
): RepeatSlotPlan {
    val slots = LinkedHashMap<String, Long>(derived.size)
    for (reminder in derived) slots[reminder.taskId] = reminder.remindAt
    if (previous == null) {
        return RepeatSlotPlan(emptySet(), derived.filter { it.remindAt > now }, slots)
    }
    // A slot that is past and no longer derived already fired: cancelling it
    // would dismiss the notification the user has not seen yet.
    val toCancel = previous.filter { (id, at) ->
        slots[id] != at && (at > now || id in slots)
    }.keys
    val toSchedule = derived.filter {
        it.remindAt > now &&
            (previous[it.taskId] != it.remindAt || armedTitles[it.taskId].let { t -> t != null && t != it.title })
    }
    return RepeatSlotPlan(toCancel, toSchedule, slots)
}

internal fun upcomingRepeatReminders(
    state: RepeatCfgSyncState,
    now: Long,
    zone: TimeZone,
    startOfNextDayDiffMs: Long,
    lookaheadDays: Int = REPEAT_LOOKAHEAD_DAYS,
    maxScheduled: Int = REPEAT_MAX_SCHEDULED,
    soonestFirst: Boolean = false,
): List<ReminderToSchedule> {
    val archived = state.archivedProjectIds
    val active = state.cfgs.filter { cfg ->
        cfg.isArmable() && (archived.isEmpty() || cfg.projectId == null || cfg.projectId !in archived)
    }
    val rows = mutableListOf<RankedReminder>()
    val countByCfgId = HashMap<String, Int>()
    // Logical day, not calendar day: see getUpcomingRepeatReminders.
    val baseDay = JsDate(now - startOfNextDayDiffMs, zone)
    baseDay.setHours(12, 0, 0, 0)

    for (dayOffset in 0..lookaheadDays) {
        val day = baseDay.copy()
        day.setDate(baseDay.dayOfMonth + dayOffset)
        val dayMs = day.timeMs
        val dayStr = getDbDateStr(day)
        for (cfg in dueOnDay(active, day, zone)) {
            if (cfg.waitForCompletion) continue
            if (!isValidSplitTime(cfg.startTime) || !hasRemindOption(cfg.remindAt)) continue
            val dueMs = getRepeatDueWithTime(cfg.startTime!!, dayMs, startOfNextDayDiffMs, zone)
            val triggerAtMs = remindOptionToMilliseconds(dueMs, cfg.remindAt) ?: continue
            if (triggerAtMs <= now) continue
            val rank = countByCfgId[cfg.id] ?: 0
            countByCfgId[cfg.id] = rank + 1
            rows.add(
                RankedReminder(
                    ReminderToSchedule(repeatTaskId(cfg.id, dayStr), cfg.title, triggerAtMs, isDeadline = false),
                    rank,
                ),
            )
        }
    }

    if (soonestFirst) {
        rows.sortWith(compareBy { it.reminder.remindAt })
    } else {
        rows.sortWith(compareBy({ it.rank }, { it.reminder.remindAt }))
    }
    return rows.take(maxScheduled).map { it.reminder }
}

private data class RankedReminder(val reminder: ReminderToSchedule, val rank: Int)

private fun repeatTaskId(cfgId: String, day: String): String = "rpt_${cfgId}_$day"

/** selectTaskRepeatCfgsForExactDay's projector, minus the archived-project filter done by the caller. */
private fun dueOnDay(cfgs: List<RepeatCfg>, day: JsDate, zone: TimeZone): List<RepeatCfg> {
    val dateStr = getDbDateStr(day)
    return cfgs.filter { cfg ->
        if (cfg.isPaused) return@filter false
        val lastDay = effectiveLastDay(cfg, zone)
        if (lastDay != null && lastDay >= dateStr) return@filter false
        if (dateStr in cfg.deletedInstanceDates) return@filter false
        val due = getNewestPossibleDueDate(cfg, day, zone) ?: return@filter false
        isSameDay(due, day)
    }
}

private fun effectiveLastDay(cfg: RepeatCfg, zone: TimeZone): String? {
    if (cfg.lastTaskCreationDay != null) return cfg.lastTaskCreationDay
    val stamp = cfg.lastTaskCreation ?: return null
    return getDbDateStr(JsDate(stamp, zone))
}

private fun effectiveStartDate(cfg: RepeatCfg): String {
    val last = cfg.lastTaskCreationDay
    if (cfg.repeatFromCompletionDate && last != null && (cfg.startDate ?: "") <= last) return last
    return cfg.startDate ?: "1970-01-01"
}

private fun getNewestPossibleDueDate(cfg: RepeatCfg, todayIn: JsDate, zone: TimeZone): JsDate? {
    if (cfg.repeatEvery < 1) return null
    val today = capAtRepeatUntil(cfg, todayIn, zone)
    val scan = repeatScanDates(cfg, today, zone) ?: return null
    val check = scan.check
    val start = scan.start
    val lastCreated = scan.lastCreated
    if (start.timeMs > check.timeMs) return null

    when (cfg.repeatCycle) {
        "DAILY" -> {
            val limit = cfg.repeatEvery + 1
            for (i in 0 until limit) {
                val diff = getDiffInDays(start, check)
                if (check.timeMs <= lastCreated.timeMs || diff < 0) break
                if (diff >= 0 && diff % cfg.repeatEvery == 0) return check
                check.setDate(check.dayOfMonth - 1)
            }
            return null
        }
        "WEEKLY" -> {
            val limit = cfg.repeatEvery * 7 + 1
            for (i in 0 until limit) {
                val diff = getDiffInWeeks(start, check)
                if (check.timeMs <= lastCreated.timeMs || diff < 0) break
                if (diff >= 0 && diff % cfg.repeatEvery == 0 && cfg.weekdaySunday0(check.dayOfWeekSunday0())) {
                    return check
                }
                check.setDate(check.dayOfMonth - 1)
            }
            return null
        }
        "MONTHLY" -> {
            if (hasNthWeekdayAnchor(cfg)) {
                return findMonthlyNth(cfg, check, zone, -1, cfg.repeatEvery + 1) { candidate, cursor ->
                    candidate.timeMs <= check.timeMs &&
                        candidate.timeMs > lastCreated.timeMs &&
                        monthDiffOnCycle(start, cursor, cfg.repeatEvery)
                }
            }
            val dayOfMonth = if (cfg.monthlyLastDay) 31 else start.dayOfMonth
            val monthDelta = if (today.dayOfMonth < clampedDayOfMonth(check, dayOfMonth)) -1 else 0
            moveToMonthDay(check, monthDelta, dayOfMonth)
            for (i in 0 until cfg.repeatEvery) {
                val diff = getDiffInMonth(start, check)
                if (check.timeMs <= lastCreated.timeMs || diff < 0) break
                if (diff >= 0 && diff % cfg.repeatEvery == 0) return check
                moveToMonthDay(check, -1, dayOfMonth)
            }
            return null
        }
        "YEARLY" -> {
            val dayOfMonth = start.dayOfMonth
            val month = start.month
            val todayAtNoon = check.copy()
            moveToYearDay(check, 0, month, dayOfMonth)
            if (check.timeMs > todayAtNoon.timeMs) moveToYearDay(check, -1, month, dayOfMonth)
            for (i in 0 until cfg.repeatEvery) {
                val diff = check.year - start.year
                if (check.timeMs <= lastCreated.timeMs || diff < 0) break
                if (diff >= 0 && diff % cfg.repeatEvery == 0) return check
                moveToYearDay(check, -1, month, dayOfMonth)
            }
            return null
        }
        else -> return null
    }
}

private fun monthDiffOnCycle(start: JsDate, cursor: JsDate, repeatEvery: Int): Boolean {
    val diff = getDiffInMonth(start, cursor)
    return diff >= 0 && diff % repeatEvery == 0
}

private data class ScanDates(val check: JsDate, val start: JsDate, val lastCreated: JsDate)

private fun repeatScanDates(cfg: RepeatCfg, from: JsDate, zone: TimeZone): ScanDates? {
    val check = from.copy()
    val start = dateStrToLocalDate(effectiveStartDate(cfg), zone) ?: return null
    val last = dateStrToLocalDate(effectiveLastDay(cfg, zone) ?: "1970-01-01", zone) ?: return null
    check.setHours(12, 0, 0, 0)
    start.setHours(12, 0, 0, 0)
    last.setHours(12, 0, 0, 0)
    return ScanDates(check, start, last)
}

private fun capAtRepeatUntil(cfg: RepeatCfg, date: JsDate, zone: TimeZone): JsDate {
    val until = cfg.repeatUntilDay ?: return date
    if (getDbDateStr(date) <= until) return date
    val end = dateStrToLocalDate(until, zone) ?: return date
    end.setHours(12, 0, 0, 0)
    return end
}

private fun hasNthWeekdayAnchor(cfg: RepeatCfg): Boolean {
    val week = cfg.monthlyWeekOfMonth
    val day = cfg.monthlyWeekday
    return week != null && day != null && (week == -1 || week in 1..4) && day in 0..6
}

private fun findMonthlyNth(
    cfg: RepeatCfg,
    from: JsDate,
    zone: TimeZone,
    direction: Int,
    maxMonths: Int,
    accept: (JsDate, JsDate) -> Boolean,
): JsDate? {
    val week = cfg.monthlyWeekOfMonth ?: return null
    val weekday = cfg.monthlyWeekday ?: return null
    val cursor = from.copy()
    cursor.setDate(1)
    for (i in 0 until maxMonths) {
        val candidate = nthWeekdayOfMonth(cursor.year, cursor.month, weekday, week, zone)
        if (accept(candidate, cursor)) return candidate
        cursor.setMonth(cursor.month + direction)
    }
    return null
}

private fun nthWeekdayOfMonth(year: Int, month: Int, weekday: Int, n: Int, zone: TimeZone): JsDate {
    if (n == -1) {
        val result = JsDate(0L, zone)
        result.setYmd(year, month + 1, 0)
        val offset = (result.dayOfWeekSunday0() - weekday + 7) % 7
        result.setDate(result.dayOfMonth - offset)
        result.setHours(12, 0, 0, 0)
        return result
    }
    val first = JsDate(0L, zone)
    first.setYmd(year, month, 1)
    val offset = (weekday - first.dayOfWeekSunday0() + 7) % 7
    val result = JsDate(0L, zone)
    result.setYmd(year, month, 1 + offset + (n - 1) * 7)
    result.setHours(12, 0, 0, 0)
    return result
}

private fun getRepeatDueWithTime(startTime: String, logicalDayMs: Long, startOfNextDayDiffMs: Long, zone: TimeZone): Long {
    val parts = startTime.split(':')
    val hour = parts[0].toInt()
    val minute = parts[1].toInt()
    val day = JsDate(logicalDayMs, zone)
    if ((hour * 60 + minute) * MINUTE_MS < startOfNextDayDiffMs) {
        day.setDate(day.dayOfMonth + 1)
    }
    day.setSeconds(0, 0)
    day.setHour(hour)
    day.setMinute(minute)
    return day.timeMs
}

private fun remindOptionToMilliseconds(due: Long, remindAt: String?): Long? = when (remindAt) {
    "AtStart" -> due
    "m5" -> due - 5 * MINUTE_MS
    "m10" -> due - 10 * MINUTE_MS
    "m15" -> due - 15 * MINUTE_MS
    "m30" -> due - 30 * MINUTE_MS
    "h1" -> due - 60 * MINUTE_MS
    "d1" -> due - DAY_MS
    "d3" -> due - 3 * DAY_MS
    "w1" -> due - 7 * DAY_MS
    else -> null
}

private fun getDiffInDays(d1: JsDate, d2: JsDate): Int {
    val a = d1.copy()
    val b = d2.copy()
    a.setHours(0, 0, 0, 0)
    b.setHours(0, 0, 0, 0)
    return Math.round((b.timeMs - a.timeMs) / DAY_MS.toDouble()).toInt()
}

private fun getDiffInWeeks(d1: JsDate, d2: JsDate): Int = Math.floorDiv(getDiffInDays(d1, d2), 7)

private fun getDiffInMonth(d1: JsDate, d2: JsDate): Int =
    (d2.year - d1.year) * 12 - d1.month + d2.month

private fun clampedDayOfMonth(date: JsDate, day: Int): Int {
    val probe = date.copy()
    probe.setDate(1)
    probe.setMonth(probe.month + 1)
    probe.setDate(0)
    return min(day, probe.dayOfMonth)
}

private fun moveToMonthDay(date: JsDate, monthDelta: Int, day: Int) {
    date.setDate(1)
    date.setMonth(date.month + monthDelta)
    date.setDate(clampedDayOfMonth(date, day))
}

private fun moveToYearDay(date: JsDate, yearDelta: Int, month: Int, day: Int) {
    date.setYear(date.year + yearDelta)
    date.setDate(1)
    date.setMonth(month)
    date.setDate(clampedDayOfMonth(date, day))
}

private fun isSameDay(a: JsDate, b: JsDate): Boolean =
    a.dayOfMonth == b.dayOfMonth && a.month == b.month && a.year == b.year

private fun getDbDateStr(date: JsDate): String =
    // Locale.ROOT: a fa/ar default locale would write non-ASCII digits and break id matching.
    String.format(Locale.ROOT, "%04d-%02d-%02d", date.year, date.month + 1, date.dayOfMonth)

private fun dateStrToLocalDate(dateStr: String, zone: TimeZone): JsDate? {
    val match = Regex("^(\\d{4})-(\\d{1,2})-(\\d{1,2})").find(dateStr) ?: return null
    val year = match.groupValues[1].toIntOrNull() ?: return null
    val month = match.groupValues[2].toIntOrNull() ?: return null
    val day = match.groupValues[3].toIntOrNull() ?: return null
    if (month !in 1..12 || day !in 1..31) return null
    val date = JsDate(0L, zone)
    date.setYmd(year, month - 1, day)
    if (date.year != year || date.month != month - 1 || date.dayOfMonth != day) return null
    return date
}

/**
 * The `Date` operations the recurrence utils actually use. Field writes are
 * lenient, matching JS (a day of 0 is the last day of the previous month).
 */
private class JsDate(timeMs: Long, private val zone: TimeZone) {
    // Gregorian and Locale.ROOT like JS Date: a Thai default locale would
    // otherwise give Buddhist-era years on some JVMs.
    private val cal: Calendar = GregorianCalendar(zone, Locale.ROOT).apply {
        // Pin every field before the first read. A bare epoch of 0 is fine;
        // callers that parse a calendar day overwrite Y-M-D next.
        timeInMillis = timeMs
    }

    val timeMs: Long get() = cal.timeInMillis
    val year: Int get() = cal.get(Calendar.YEAR)
    val month: Int get() = cal.get(Calendar.MONTH)
    val dayOfMonth: Int get() = cal.get(Calendar.DAY_OF_MONTH)

    fun copy(): JsDate = JsDate(cal.timeInMillis, zone)

    fun dayOfWeekSunday0(): Int = (cal.get(Calendar.DAY_OF_WEEK) + 6) % 7

    fun setHours(hour: Int, minute: Int, second: Int, ms: Int) {
        cal.set(Calendar.HOUR_OF_DAY, hour)
        cal.set(Calendar.MINUTE, minute)
        cal.set(Calendar.SECOND, second)
        cal.set(Calendar.MILLISECOND, ms)
    }

    fun setHour(hour: Int) {
        cal.set(Calendar.HOUR_OF_DAY, hour)
    }

    fun setMinute(minute: Int) {
        cal.set(Calendar.MINUTE, minute)
    }

    fun setSeconds(second: Int, ms: Int) {
        cal.set(Calendar.SECOND, second)
        cal.set(Calendar.MILLISECOND, ms)
    }

    fun setDate(day: Int) {
        cal.set(Calendar.DAY_OF_MONTH, day)
    }

    fun setMonth(month: Int) {
        cal.set(Calendar.MONTH, month)
    }

    fun setYear(year: Int) {
        cal.set(Calendar.YEAR, year)
    }

    fun setYmd(year: Int, month: Int, day: Int) {
        cal.set(Calendar.MILLISECOND, 0)
        cal.set(year, month, day, 0, 0, 0)
    }
}

/**
 * True when this id is an occurrence the repeat config has already turned
 * into a task. The task reminder path owns that alarm; cancelling it here
 * would drop a reminder the user still has.
 */
internal fun isLiveRepeatInstance(
    reminderId: String,
    state: RepeatCfgSyncState,
    zone: TimeZone,
): Boolean {
    val parsed = parseRepeatOccurrenceId(reminderId) ?: return false
    val cfg = state.byId(parsed.cfgId) ?: return false
    if (!cfg.isComplete) return false
    val last = effectiveLastDay(cfg, zone) ?: return false
    return parsed.day <= last
}

/** Alarm-store rows that are pre-scheduled occurrences, not instances already created. */
internal fun seedRepeatSlots(
    alarms: List<Pair<String, Long>>,
    state: RepeatCfgSyncState,
    zone: TimeZone,
): Map<String, Long> {
    val out = LinkedHashMap<String, Long>()
    for ((reminderId, triggerAtMs) in alarms) {
        val parsed = parseRepeatOccurrenceId(reminderId) ?: continue
        val cfg = state.byId(parsed.cfgId) ?: continue
        if (!cfg.isComplete) continue
        val last = effectiveLastDay(cfg, zone)
        if (last != null && parsed.day <= last) continue
        out[reminderId] = triggerAtMs
    }
    return out
}
