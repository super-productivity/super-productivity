package com.superproductivity.superproductivity.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import com.superproductivity.superproductivity.service.BackgroundReminderSettingsStore
import com.superproductivity.superproductivity.service.BackgroundSyncCredentialStore
import com.superproductivity.superproductivity.service.QuickFetchCoalescer
import com.superproductivity.superproductivity.service.ReminderChangeResult
import com.superproductivity.superproductivity.service.ReminderNotificationHelper
import com.superproductivity.superproductivity.service.SuperSyncBackgroundProvider
import com.superproductivity.superproductivity.service.buildPayloadDecryptor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Receives alarm broadcasts and shows reminder notifications.
 * Before showing, does a quick server check to suppress stale notifications
 * (task deleted/done/dismissed on another device). Fail-open on any error.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "ReminderAlarmReceiver"
        const val ACTION_SHOW_REMINDER = "com.superproductivity.ACTION_SHOW_REMINDER"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_REMINDER_ID = "reminder_id"
        const val EXTRA_RELATED_ID = "related_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_REMINDER_TYPE = "reminder_type"
        const val EXTRA_USE_ALARM_STYLE = "use_alarm_style"
        const val EXTRA_IS_ONGOING = "is_ongoing"
        const val EXTRA_TRIGGER_AT_MS = "trigger_at_ms"

        /** Alarms that fire together share one stale-check GET; see [QuickFetchCoalescer]. */
        private val staleCheckFetches =
            QuickFetchCoalescer<Triple<String, String, Long>, ReminderChangeResult?>(
                // Covers one owner's worst case (5s callTimeout) plus the alarms
                // queued behind it. Kept short: a reused result can't see ops
                // uploaded after it, e.g. a task just marked done on another device.
                ttlMs = 15_000L,
                // Monotonic: a wall clock set backwards would keep a result alive past the ttl.
                nowMs = SystemClock::elapsedRealtime,
            )

        /**
         * Re-checks that derive the key for a new desktop session. Separate from
         * [staleCheckFetches] so they never answer the cheap check, and longer-lived
         * because one derivation holds 64 MiB and can outlast that ttl on slow phones.
         * Trade-off: an alarm within the ttl reuses that result and misses a done op
         * from yet another new desktop session; it then rings (fails open).
         */
        private val derivingFetches =
            QuickFetchCoalescer<Triple<String, String, Long>, ReminderChangeResult?>(
                ttlMs = 60_000L,
                nowMs = SystemClock::elapsedRealtime,
            )

        // Not tied to one alarm: a derivation that misses the deadline keeps
        // running (best effort: Android may kill the idle process) and caches the
        // key for the next alarm and SyncReminderWorker.
        private val derivingScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

        // Whole stale check, both fetches included, must end inside the ~10s
        // goAsync() window. A cold derivation measured 1.4s on an x86 emulator
        // (2026-10); phones are slower, so it gets whatever the first fetch leaves.
        private const val CHECK_BUDGET_MS = 8_000L
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SHOW_REMINDER) return

        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1)
        val reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: return
        val relatedId = intent.getStringExtra(EXTRA_RELATED_ID) ?: return
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Reminder"
        val reminderType = intent.getStringExtra(EXTRA_REMINDER_TYPE) ?: "TASK"
        val useAlarmStyle = intent.getBooleanExtra(EXTRA_USE_ALARM_STYLE, false)
        val isOngoing = intent.getBooleanExtra(EXTRA_IS_ONGOING, false)
        val triggerAtMs = intent.getLongExtra(EXTRA_TRIGGER_AT_MS, 0L)

        Log.d(TAG, "Alarm triggered: id=$notificationId, triggerAt=$triggerAtMs")

        // Reminders disabled (mirrored from the app): every app scheduling path
        // stops then, but alarms SyncReminderWorker set before the setting
        // reached this phone are not tracked by the app and would still ring.
        if (BackgroundReminderSettingsStore.get(context).isDisabled) {
            Log.d(TAG, "Reminders disabled, dropping alarm: id=$notificationId")
            ReminderNotificationHelper.cancelReminder(context, notificationId)
            return
        }

        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                val isStale = isTaskStale(context, relatedId, triggerAtMs, reminderType)
                if (isStale) {
                    Log.d(TAG, "Suppressed stale notification: id=$notificationId, task=$relatedId")
                    ReminderNotificationHelper.cancelReminder(context, notificationId)
                } else {
                    ReminderNotificationHelper.showNotification(
                        context, notificationId, reminderId, relatedId,
                        title, reminderType, useAlarmStyle, isOngoing
                    )
                }
            } catch (e: Exception) {
                // Fail-open: show notification on any error
                Log.w(TAG, "Check failed, showing notification anyway: id=$notificationId", e)
                ReminderNotificationHelper.showNotification(
                    context, notificationId, reminderId, relatedId,
                    title, reminderType, useAlarmStyle, isOngoing
                )
            } finally {
                pendingResult.finish()
            }
        }
    }

    /**
     * Quick server check: is this task stale (deleted/done/dismissed/rescheduled)?
     * Uses fetchQuick with tight OkHttp timeouts (5s callTimeout) that actually
     * interrupt blocking I/O. Returns false (fail-open) on any error or timeout.
     *
     * Only checks the triggering task — all other reminder management is left
     * to the SyncReminderWorker which owns the seq cursor and handles pagination.
     *
     * @param triggerAtMs The alarm's scheduled trigger time. Used to distinguish
     *   "this is the current schedule" from "this was rescheduled to a different time".
     */
    private suspend fun isTaskStale(context: Context, taskId: String, triggerAtMs: Long, reminderType: String): Boolean {
        val deadlineMs = SystemClock.elapsedRealtime() + CHECK_BUDGET_MS
        val credentials = BackgroundSyncCredentialStore.get(context) ?: return false
        val lastSeq = BackgroundSyncCredentialStore.getLastServerSeq(
            context, credentials.baseUrl
        )

        // Token in the key: a re-login on the same server keeps lastSeq, and one
        // account's result must never answer for another's alarms.
        val cacheKey = Triple(credentials.baseUrl, credentials.accessToken, lastSeq)
        val result = staleCheckFetches.get(cacheKey) {
            // Cache-only decryptor: a cold KDF takes seconds and would blow the
            // goAsync() window. Ops with unknown salts degrade to envelope-only
            // parsing and are reported in unreadableTaskIds.
            val decryptor = buildPayloadDecryptor(context, TAG, deriveOnMiss = false)
            SuperSyncBackgroundProvider(decryptor).fetchQuick(
                credentials.baseUrl, credentials.accessToken, lastSeq
            )
        } ?: return false  // Error -> fail-open

        if (result.isAlarmStale(taskId, triggerAtMs, reminderType)) return true
        if (taskId !in result.unreadableTaskIds) return false
        val derived = fetchWithDerivedKey(context, cacheKey, deadlineMs) ?: return false
        return derived.isAlarmStale(taskId, triggerAtMs, reminderType)
    }

    /**
     * Every desktop launch encrypts with a new salt, so a task completed right
     * after a desktop restart is unreadable until its key is derived. Derive it
     * now, but only wait until [deadlineMs]; past that, return null (fail open).
     *
     * shortcut: re-fetches the same page instead of re-parsing the first
     * response — keep the raw body if the second GET ever shows up in load.
     */
    private suspend fun fetchWithDerivedKey(
        context: Context,
        cacheKey: Triple<String, String, Long>,
        deadlineMs: Long,
    ): ReminderChangeResult? {
        val (baseUrl, accessToken, lastSeq) = cacheKey
        // No stored password: deriving is impossible, so a second GET would only repeat the first.
        val decryptor = buildPayloadDecryptor(context, TAG) ?: return null
        val derived = derivingScope.async {
            derivingFetches.get(cacheKey) {
                SuperSyncBackgroundProvider(decryptor).fetchQuick(baseUrl, accessToken, lastSeq)
            }
        }
        val waitMs = deadlineMs - SystemClock.elapsedRealtime()
        val result = withTimeoutOrNull(waitMs.coerceAtLeast(0L)) { derived.await() }
        if (result == null) Log.d(TAG, "No derived-key result by the alarm deadline, failing open")
        return result
    }
}
