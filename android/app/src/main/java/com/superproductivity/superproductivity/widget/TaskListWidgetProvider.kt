package com.superproductivity.superproductivity.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateUtils
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R

/**
 * Home screen widget listing Today's tasks, or the open tasks of one project picked
 * per widget instance (#9518), from the `widget_data` KeyValStore snapshot pushed
 * by Angular. Checkbox taps enqueue the task ID in [WidgetDoneQueue]; Angular
 * drains the queue (instantly via the local drain broadcast when alive, otherwise
 * on next resume/cold start).
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
        prefs(context).edit().apply {
            appWidgetIds.forEach { remove(selectionKey(it)) }
            apply()
        }
        clearPendingProjectToOpen(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
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
                Log.d(TAG, "Toggle done from widget: taskId=$taskId setDone=$setDone")
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
            }

            intent.getBooleanExtra(EXTRA_OPEN_APP, false) -> {
                // Queued before the launch: a blocked background launch is silent
                // (startActivity returns normally), so the entry carries its own
                // timestamp and goes stale instead of hijacking a later app start.
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
                    // API levels/OEMs; the header tap (direct activity PendingIntent)
                    // remains as the reliable way in.
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
        const val ACTION_WIDGET_DONE_DRAIN =
            "com.superproductivity.superproductivity.WIDGET_DONE_DRAIN"
        const val ACTION_WIDGET_PROJECT_OPEN_DRAIN =
            "com.superproductivity.superproductivity.WIDGET_PROJECT_OPEN_DRAIN"
        const val EXTRA_TASK_ID = "WIDGET_TASK_ID"
        const val EXTRA_SET_DONE = "WIDGET_SET_DONE"
        const val EXTRA_OPEN_APP = "WIDGET_OPEN_APP"
        const val EXTRA_OPEN_PROJECT_ID = "WIDGET_OPEN_PROJECT_ID"

        // Excluded from backup and device transfer (backup_rules.xml,
        // data_extraction_rules.xml): widget ids are not preserved across a restore.
        private const val PREFERENCES_NAME = "task_list_widget"
        private const val PENDING_OPEN_PROJECT_KEY = "pending_open_project"
        private const val PENDING_OPEN_PROJECT_AT_KEY = "pending_open_project_at"

        private fun widgetIds(context: Context, appWidgetManager: AppWidgetManager): IntArray =
            appWidgetManager.getAppWidgetIds(
                ComponentName(context, TaskListWidgetProvider::class.java)
            )

        private fun prefs(context: Context) =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

        private fun selectionKey(appWidgetId: Int): String = "project_$appWidgetId"

        /**
         * One read of the blob per refresh, shared by every widget id: the Today
         * header (or its #9098 outdated form), the current-task row, and the raw
         * JSON so a project widget can look up its own title without reading again.
         */
        private data class Snapshot(
            val json: String?,
            val todayHeader: CharSequence,
            val currentTask: WidgetCurrentTask?
        )

        /**
         * "Today" while the snapshot still describes the current logical day,
         * otherwise the snapshot's own date. Only Angular can compute today's list —
         * today's repeat instances do not exist as entities until its day-change
         * effects have run, and overdue tasks are carried over there too — so a
         * process that stayed dead across midnight leaves yesterday's blob in place.
         * Name the day actually on screen rather than mislabelling it "Today" (#9098).
         *
         * Reads the blob itself: the header lives in the provider's RemoteViews while
         * the rows are built in a separate RemoteViewsFactory, with no shared lifetime
         * to hand it down.
         */
        private fun readSnapshot(context: Context): Snapshot {
            val json = try {
                (context.applicationContext as App).keyValStore.get(WidgetData.KEYVAL_KEY, "{}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read widget data for header", e)
                // Unknown stamp: keep the pre-#9098 behaviour rather than cry stale.
                return Snapshot(null, context.getString(R.string.widget_header_title), null)
            }
            val meta = WidgetData.parseMeta(json)
            val nowMs = System.currentTimeMillis()
            // The verdict lives in WidgetData.headerFor (pure, tested); this only renders it.
            val header = when (val h = WidgetData.headerFor(meta, nowMs)) {
                is WidgetHeader.Today -> context.getString(R.string.widget_header_title)
                is WidgetHeader.Outdated -> h.dayMs?.let { dayMs ->
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
            return Snapshot(json, header, WidgetData.parseCurrentTask(json, nowMs))
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
         * The obvious "cheaper" partiallyUpdateAppWidget is a trap — despite its docs it
         * does not ignore a widget with no cached views, it *replaces* them, so it would
         * install a header with no adapter and no click targets on any widget whose views
         * the system has dropped (an app upgrade clears them explicitly).
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

        /** Re-renders one widget, e.g. after its project was picked. */
        fun refresh(context: Context, appWidgetId: Int) {
            updateAll(context, AppWidgetManager.getInstance(context), intArrayOf(appWidgetId))
        }

        /** Rebuilds each passed widget from one read of the blob. */
        private fun updateAll(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetIds: IntArray
        ) {
            val snapshot = readSnapshot(context)
            for (appWidgetId in appWidgetIds) {
                // A selection can outlive its project (deleted, archived or hidden,
                // possibly on another device): header and list then both fall back
                // to Today, and the selection is kept so un-hiding restores it.
                val projectId = selectedProjectId(context, appWidgetId)
                val projectTitle = projectId?.let { id ->
                    snapshot.json?.let { json ->
                        try {
                            WidgetData.projectTitle(json, id)
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to read selected project for widget header", e)
                            null
                        }
                    }
                }
                updateWidget(
                    context,
                    appWidgetManager,
                    appWidgetId,
                    header = projectTitle ?: snapshot.todayHeader,
                    projectIdToOpen = projectId.takeIf { projectTitle != null },
                    currentTask = snapshot.currentTask
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
            projectIdToOpen: String?,
            currentTask: WidgetCurrentTask?
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_task_list)

            views.setTextViewText(R.id.widget_header_title, header)

            if (currentTask != null) {
                views.setViewVisibility(R.id.widget_tracking_row, View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_tracking_title,
                    context.getString(R.string.widget_tracking_title, currentTask.title)
                )
                views.setTextViewText(
                    R.id.widget_tracking_device,
                    context.getString(R.string.widget_tracking_device, currentTask.deviceLabel)
                )
            } else {
                views.setViewVisibility(R.id.widget_tracking_row, View.GONE)
            }

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

            // Header tap → open app
            val openAppIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val openAppPendingIntent = PendingIntent.getActivity(
                context, 0, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            // Header/empty tap on a project widget → open that project. Still a direct
            // activity PendingIntent (background-activity-launch restrictions do not
            // apply); the per-widget data Uri and request code keep one widget's
            // project extra from overwriting another's under FLAG_UPDATE_CURRENT.
            val openSourcePendingIntent = projectIdToOpen?.let { projectId ->
                PendingIntent.getActivity(
                    context,
                    appWidgetId,
                    Intent(context, CapacitorMainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra(EXTRA_OPEN_PROJECT_ID, projectId)
                        data = Uri.parse("widget-open:$appWidgetId")
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            } ?: openAppPendingIntent
            views.setOnClickPendingIntent(R.id.widget_header, openSourcePendingIntent)
            views.setOnClickPendingIntent(R.id.widget_empty, openSourcePendingIntent)
            views.setOnClickPendingIntent(R.id.widget_tracking_row, openAppPendingIntent)

            // "+" → quick add dialog; the app itself stays closed. The capture goes
            // to Today on every widget, project widgets included.
            val quickAddIntent = Intent(context, QuickAddActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val quickAddPendingIntent = PendingIntent.getActivity(
                context, 0, quickAddIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_add, quickAddPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        fun selectedProjectId(context: Context, appWidgetId: Int): String? =
            prefs(context).getString(selectionKey(appWidgetId), null)

        fun setSelectedProjectId(context: Context, appWidgetId: Int, projectId: String?) {
            prefs(context).edit().apply {
                if (projectId == null) {
                    remove(selectionKey(appWidgetId))
                } else {
                    putString(selectionKey(appWidgetId), projectId)
                }
                apply()
            }
        }

        @Synchronized
        fun queueProjectToOpen(context: Context, projectId: String) {
            // commit (not apply): a row tap queues from a short-lived broadcast.
            prefs(context).edit()
                .putString(PENDING_OPEN_PROJECT_KEY, projectId)
                .putLong(PENDING_OPEN_PROJECT_AT_KEY, System.currentTimeMillis())
                .commit()
        }

        /** The queued project, unless it is older than a tap the app could still be serving. */
        @Synchronized
        fun getAndClearProjectToOpen(context: Context): String? {
            val prefs = prefs(context)
            val projectId = prefs.getString(PENDING_OPEN_PROJECT_KEY, null) ?: return null
            val queuedAtMs = prefs.getLong(PENDING_OPEN_PROJECT_AT_KEY, 0L)
            clearPendingProjectToOpen(context)
            return projectId.takeIf {
                WidgetData.isProjectOpenRequestFresh(queuedAtMs, System.currentTimeMillis())
            }
        }

        @Synchronized
        fun clearPendingProjectToOpen(context: Context) {
            prefs(context).edit()
                .remove(PENDING_OPEN_PROJECT_KEY)
                .remove(PENDING_OPEN_PROJECT_AT_KEY)
                .commit()
        }
    }
}
