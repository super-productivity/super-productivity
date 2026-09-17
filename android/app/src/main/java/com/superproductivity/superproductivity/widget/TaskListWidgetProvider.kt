package com.superproductivity.superproductivity.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.format.DateUtils
import android.util.Log
import android.widget.RemoteViews
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R

/**
 * Home screen widget listing Today or one selected project's tasks from the
 * `widget_data` KeyValStore snapshot pushed by Angular. Checkbox taps enqueue the task ID in
 * [WidgetDoneQueue]; Angular drains the queue (instantly via the local drain
 * broadcast when alive, otherwise on next resume/cold start).
 */
class TaskListWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        updateAll(context, appWidgetManager, appWidgetIds)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        super.onDeleted(context, appWidgetIds)
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE).edit().apply {
            appWidgetIds.forEach { remove(selectionKey(it)) }
            apply()
        }
        clearPendingProjectToOpen(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_EXPIRY_REFRESH) {
            refreshAll(context)
            return
        }
        if (intent.action != ACTION_CLICK) {
            return
        }
        // A collection view has a single PendingIntent template, so both row
        // outcomes arrive here; the fill-in extras decide which one was tapped.
        val taskId = intent.getStringExtra(EXTRA_TASK_ID)
        when {
            taskId != null -> {
                // Target state computed at render time from the DISPLAYED state
                // (incl. pending overlay), so repeated taps toggle back and forth.
                val setDone = intent.getBooleanExtra(EXTRA_SET_DONE, true)
                WidgetDoneQueue.setTarget(context, taskId, setDone)
                // Re-render so the pending-done overlay shows the checked box. Full
                // refresh, not rows-only: the tap cannot change the blob, but the
                // verdict is a function of *now*, and this is the one interaction that
                // reaches our code while the app process is dead — so a tap on a new
                // day must not redraw rows under a header still claiming "Today".
                refreshAll(context)
                // Contentless "drain now" signal for a live app; Angular always
                // pulls the IDs from the queue itself (single delivery path).
                LocalBroadcastManager.getInstance(context)
                    .sendBroadcast(Intent(ACTION_WIDGET_DONE_DRAIN))
                // Keep expiry tied to this task's tap. The non-waking system alarm delivers
                // to the provider after process death when the device is active; when exact
                // alarms are unavailable, a short-lived in-process Handler gives a timely
                // refresh while the inexact alarm remains as the process-death fallback.
                // Neither path blocks later checkbox taps or wakes a sleeping device for
                // this cosmetic update.
                scheduleProjectTaskExpiryRefresh(context, taskId, setDone)
            }

            intent.getBooleanExtra(EXTRA_OPEN_APP, false) -> {
                val projectId = intent.getStringExtra(EXTRA_OPEN_PROJECT_ID)
                if (projectId != null) {
                    queueProjectToOpen(context, projectId)
                }
                try {
                    context.startActivity(
                        Intent(context, CapacitorMainActivity::class.java).apply {
                            flags =
                                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        }
                    )
                    if (projectId != null) {
                        LocalBroadcastManager.getInstance(context)
                            .sendBroadcast(Intent(ACTION_WIDGET_PROJECT_OPEN_DRAIN))
                    }
                } catch (e: Exception) {
                    // Background-activity-launch restrictions may block this on some
                    // API levels/OEMs.
                    if (projectId != null) {
                        clearPendingProjectToOpen(context)
                    }
                    Log.w(TAG, "Failed to open app from widget row tap", e)
                }
            }
        }
    }

    companion object {
        private const val TAG = "TaskListWidget"
        const val ACTION_CLICK = "com.superproductivity.superproductivity.WIDGET_CLICK"
        const val ACTION_EXPIRY_REFRESH =
            "com.superproductivity.superproductivity.WIDGET_EXPIRY_REFRESH"
        const val ACTION_WIDGET_DONE_DRAIN =
            "com.superproductivity.superproductivity.WIDGET_DONE_DRAIN"
        const val ACTION_WIDGET_PROJECT_OPEN_DRAIN =
            "com.superproductivity.superproductivity.WIDGET_PROJECT_OPEN_DRAIN"
        const val EXTRA_TASK_ID = "WIDGET_TASK_ID"
        const val EXTRA_SET_DONE = "WIDGET_SET_DONE"
        const val EXTRA_OPEN_APP = "WIDGET_OPEN_APP"
        const val EXTRA_OPEN_PROJECT_ID = "WIDGET_OPEN_PROJECT_ID"

        private fun widgetIds(context: Context, appWidgetManager: AppWidgetManager): IntArray =
            appWidgetManager.getAppWidgetIds(
                ComponentName(context, TaskListWidgetProvider::class.java)
            )

        /**
         * "Today" while the snapshot still describes the current logical day,
         * otherwise the snapshot's own date. Only Angular can compute today's list —
         * today's repeat instances do not exist as entities until its day-change
         * effects have run, and overdue tasks are carried over there too — so a
         * process that stayed dead across midnight leaves yesterday's blob in place.
         * Name the day actually on screen rather than mislabelling it "Today" (#9098).
         *
         * Project widgets use the selected snapshot project's title. A missing selection
         * falls back to the Today header and list together.
         */
        private data class WidgetDisplay(
            val header: CharSequence,
            val projectIdToOpen: String?
        )

        private fun widgetDisplay(context: Context, appWidgetId: Int): WidgetDisplay {
            val snapshot = try {
                (context.applicationContext as App).keyValStore
                    .get(WidgetData.KEYVAL_KEY, "{}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read widget data for header", e)
                // Unknown stamp: keep the pre-#9098 behaviour rather than cry stale.
                return WidgetDisplay(context.getString(R.string.widget_header_title), null)
            }
            val selectedId = selectedProjectId(context, appWidgetId)
            val selectedProjectTitle = selectedId?.let { projectId ->
                try {
                    WidgetData.projectTitle(snapshot, projectId)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to read selected project for widget header", e)
                    null
                }
            }
            selectedProjectTitle?.let { title -> return WidgetDisplay(title, selectedId) }
            val meta = WidgetData.parseMeta(snapshot)
            // The verdict lives in WidgetData.headerFor (pure, tested); this only renders it.
            val header = when (val header = WidgetData.headerFor(meta, System.currentTimeMillis())) {
                is WidgetHeader.Today -> context.getString(R.string.widget_header_title)
                is WidgetHeader.Outdated -> header.dayMs?.let { dayMs ->
                    context.getString(
                        R.string.widget_header_outdated,
                        DateUtils.formatDateTime(
                            context,
                            dayMs,
                            DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_WEEKDAY or
                                DateUtils.FORMAT_ABBREV_MONTH or DateUtils.FORMAT_ABBREV_WEEKDAY
                        )
                    )
                } ?: context.getString(R.string.widget_header_outdated_unknown)
            }
            return WidgetDisplay(header, null)
        }

        /**
         * Refreshes rows and header — every caller needs both. A push can change the day
         * the blob describes (it is how a widget stops being outdated), and a tap, though
         * it cannot change the blob, still re-renders at a later *now* than the last
         * verdict was computed at. The header is not part of the collection, so neither
         * can be a rows-only reload.
         *
         * A full update is deliberate, not lazy. It costs a few PendingIntents on a
         * debounced-and-deduped path, and it does NOT cost scroll position: the host
         * reapplies onto the recycled view (same layout id) and AbsListView keeps the
         * bound adapter when the adapter intent is unchanged, which it always is here.
         * The full update establishes the complete cached hierarchy, adapter, and click
         * targets. Some hosts can nevertheless retain the previous header when that
         * update also changes the RemoteViews collection, so updateWidget follows it
         * with a header-only partial update. Partial updates are ignored before a full
         * update, making this ordering safe while preserving the established collection.
         */
        fun refreshAll(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val ids = widgetIds(context, appWidgetManager)
            // Every push reaches here; without a widget there is nothing to read for.
            if (ids.isEmpty()) {
                return
            }
            updateAll(context, appWidgetManager, ids)
        }

        fun refresh(context: Context, appWidgetId: Int) {
            updateAll(context, AppWidgetManager.getInstance(context), intArrayOf(appWidgetId))
        }

        /** Schedules or cancels this task's local five-second completion expiry. */
        private fun scheduleProjectTaskExpiryRefresh(
            context: Context,
            taskId: String,
            setDone: Boolean
        ) {
            val appContext = context.applicationContext
            val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pendingIntent = expiryRefreshPendingIntent(appContext, taskId)
            if (!setDone) {
                alarmManager.cancel(pendingIntent)
                return
            }
            val refreshAtMs = WidgetDoneQueue.peekDoneTimestamps(appContext)[taskId]
                ?.plus(WidgetData.PROJECT_DONE_TASK_GRACE_MS)
                ?: return
            val delayMs = (refreshAtMs - System.currentTimeMillis()).coerceAtLeast(0L)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    !alarmManager.canScheduleExactAlarms()
                ) {
                    alarmManager.set(
                        AlarmManager.RTC,
                        refreshAtMs,
                        pendingIntent
                    )
                    // Exact-alarm permission is optional. A process-local timer keeps the
                    // normal five-second UX when the app remains alive, while the alarm
                    // still delivers to the provider when the device is awake if Android
                    // kills this process.
                    postInProcessExpiryRefresh(appContext, delayMs)
                } else {
                    alarmManager.setExact(
                        AlarmManager.RTC,
                        refreshAtMs,
                        pendingIntent
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to schedule widget task grace-period refresh", e)
                // A denied exact alarm can race with permission state changes. Always try
                // the non-waking system fallback before the in-process timer, so process
                // death does not lose the expiry refresh.
                try {
                    alarmManager.set(AlarmManager.RTC, refreshAtMs, pendingIntent)
                } catch (fallbackException: Exception) {
                    Log.e(
                        TAG,
                        "Failed to schedule inexact widget expiry fallback",
                        fallbackException
                    )
                }
                postInProcessExpiryRefresh(appContext, delayMs)
            }
        }

        private fun postInProcessExpiryRefresh(context: Context, delayMs: Long) {
            Handler(Looper.getMainLooper()).postDelayed(
                {
                    try {
                        refreshAll(context)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to refresh widget after task grace period", e)
                    }
                },
                delayMs
            )
        }

        private fun expiryRefreshPendingIntent(context: Context, taskId: String): PendingIntent {
            val intent = Intent(context, TaskListWidgetProvider::class.java).apply {
                action = ACTION_EXPIRY_REFRESH
                // Separate alarms preserve each task's original tap deadline. The data is
                // used only for PendingIntent identity; it is never logged or displayed.
                data = Uri.parse("widget-expiry:$taskId")
            }
            return PendingIntent.getBroadcast(
                context,
                EXPIRY_REFRESH_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        /** Rebuilds every passed widget using that instance's selected source. */
        private fun updateAll(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetIds: IntArray
        ) {
            for (appWidgetId in appWidgetIds) {
                val display = widgetDisplay(context, appWidgetId)
                updateWidget(
                    context,
                    appWidgetManager,
                    appWidgetId,
                    display.header,
                    display.projectIdToOpen
                )
            }
            // setRemoteAdapter alone does not re-invoke the factory's onDataSetChanged()
            // when the adapter intent is unchanged (it always is — same widget id, same
            // Uri), so the rows would otherwise be whatever the adapter last built.
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetIds, R.id.widget_task_list)
        }

        private fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            header: CharSequence,
            projectIdToOpen: String?
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_task_list)

            views.setTextViewText(R.id.widget_header_title, header)

            val serviceIntent = Intent(context, TaskListWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.widget_task_list, serviceIntent)
            views.setEmptyView(R.id.widget_task_list, R.id.widget_empty)

            // Single template for all row clicks (explicit component — needs no
            // manifest intent-filter entry). MUTABLE is required for fill-ins.
            val clickIntent = Intent(context, TaskListWidgetProvider::class.java).apply {
                action = ACTION_CLICK
            }
            val clickPendingIntent = PendingIntent.getBroadcast(
                context, 0, clickIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            views.setPendingIntentTemplate(R.id.widget_task_list, clickPendingIntent)

            // Header/empty tap → open this widget's configured source directly. Direct
            // activity PendingIntents avoid background-activity-launch restrictions.
            val openAppIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                projectIdToOpen?.let { projectId -> putExtra(EXTRA_OPEN_PROJECT_ID, projectId) }
                data = Uri.parse("widget-open:$appWidgetId")
            }
            val openAppPendingIntent = PendingIntent.getActivity(
                context, appWidgetId, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_header, openAppPendingIntent)
            views.setOnClickPendingIntent(R.id.widget_empty, openAppPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
            // Some widget hosts retain the previous TextView value when a full update
            // also changes a RemoteViews collection. Reapply the header after the full
            // update; the hierarchy is present by then, so this partial update is safe.
            val headerViews = RemoteViews(context.packageName, R.layout.widget_task_list)
            headerViews.setTextViewText(R.id.widget_header_title, header)
            appWidgetManager.partiallyUpdateAppWidget(appWidgetId, headerViews)
        }

        fun selectedProjectId(context: Context, appWidgetId: Int): String? =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .getString(selectionKey(appWidgetId), null)

        @Synchronized
        fun queueProjectToOpen(context: Context, projectId: String) {
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PENDING_OPEN_PROJECT_KEY, projectId)
                .commit()
        }

        @Synchronized
        fun getAndClearProjectToOpen(context: Context): String? {
            val prefs = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            val projectId = prefs.getString(PENDING_OPEN_PROJECT_KEY, null)
            if (projectId != null) {
                prefs.edit().remove(PENDING_OPEN_PROJECT_KEY).commit()
            }
            return projectId
        }

        @Synchronized
        fun clearPendingProjectToOpen(context: Context) {
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(PENDING_OPEN_PROJECT_KEY)
                .commit()
        }

        fun setSelectedProjectId(context: Context, appWidgetId: Int, projectId: String?) {
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE).edit().apply {
                if (projectId == null) {
                    remove(selectionKey(appWidgetId))
                } else {
                    putString(selectionKey(appWidgetId), projectId)
                }
                apply()
            }
        }

        private fun selectionKey(appWidgetId: Int): String = "project_$appWidgetId"

        private const val PREFERENCES_NAME = "task_list_widget"
        private const val PENDING_OPEN_PROJECT_KEY = "pending_open_project"
        private const val EXPIRY_REFRESH_REQUEST_CODE = 0
    }
}
