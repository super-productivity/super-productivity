package com.superproductivity.superproductivity.service

import android.content.Context
import java.util.TimeZone

/**
 * Arms the repeat alarms derived from the cache the worker already has.
 * Does not download anything. [protectedIds] are task reminder ids this run
 * already scheduled (or that the sync file still lists): the task path owns
 * those alarms, including a live instance whose id is `rpt_<cfg>_<day>`.
 */
internal fun armRepeatReminders(
    context: Context,
    state: RepeatCfgSyncState,
    useAlarmStyle: Boolean,
    protectedIds: Set<String>,
    now: Long = System.currentTimeMillis(),
    zone: TimeZone = TimeZone.getDefault(),
) {
    val stored = RepeatReminderCache.getSlots(context)
    // No snapshot yet (for example a WebDAV 304 before the first readable
    // file): do not claim the alarm list, or the app's pre-scheduled
    // occurrences could never be reconciled.
    if (stored == null && state.cfgs.none { it.isComplete }) return

    val offset = BackgroundReminderSettingsStore.get(context).startOfNextDayDiffMs
    val derived = upcomingRepeatReminders(state, now, zone, offset)
        .filter { it.taskId !in protectedIds }
    val previous = stored ?: seedRepeatSlots(
        ReminderAlarmStore.getAll(context).map { it.reminderId to it.triggerAtMs },
        state,
        zone,
    ).ifEmpty { null }
    val plan = planRepeatReminderSlots(previous, derived, now)
    for (reminderId in plan.toCancel) {
        if (reminderId in protectedIds || isLiveRepeatInstance(reminderId, state, zone)) continue
        cancelReminderById(context, reminderId)
    }
    for (reminder in plan.toSchedule) {
        if (reminder.taskId in protectedIds) continue
        scheduleReminderFromSync(context, reminder, useAlarmStyle)
    }
    RepeatReminderCache.saveSlots(context, plan.slots)
}
