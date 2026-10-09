package com.superproductivity.superproductivity.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateUtils
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R
import com.superproductivity.superproductivity.service.TrackingForegroundService

/**
 * Home screen widget showing the task currently being tracked — on this device,
 * or (SuperSync only) the last-known remote device — from the same `widget_data`
 * KeyValStore snapshot the today's-tasks widget reads (`currentTask` field).
 * Separate widget rather than a row on the task list, so it can be placed and
 * resized independently.
 *
 * The stop button is local-tracking only (see `WidgetCurrentTask.isLocal`):
 * stopping a REMOTE device's tracking needs a websocket round trip
 * (TrackingPresenceService.requestRemoteStop), which needs the app connected
 * live — out of scope for a widget tap that may reach a dead process.
 */
class TrackingWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        updateAll(context, appWidgetManager, appWidgetIds)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        WidgetBackground.remove(context, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_STOP) {
            return
        }
        val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
        Log.d(TAG, "Stop tracking tap from widget: taskId=$taskId")
        // Stop the native counter here, not in Angular: with the activity
        // dismissed from recents nothing would drain the queue, and the
        // foreground service would keep accruing time until the app is reopened.
        // The frozen total is handed to Angular to book exactly up to the tap.
        val elapsedMs = if (
            TrackingForegroundService.isTracking &&
            TrackingForegroundService.currentTaskId == taskId
        ) {
            TrackingForegroundService.getElapsedMs()
        } else {
            null
        }
        WidgetTrackingStopQueue.request(context, taskId, elapsedMs)
        if (elapsedMs != null) {
            TrackingForegroundService.requestStop(context)
        }
        refreshAll(context)
        TaskListWidgetProvider.refreshAll(context)
        // Contentless "drain now" signal for a live app — shared with the
        // task-list widget's done-tap queue, both mean "check native queues now".
        LocalBroadcastManager.getInstance(context)
            .sendBroadcast(Intent(TaskListWidgetProvider.ACTION_WIDGET_DONE_DRAIN))
    }

    companion object {
        private const val TAG = "TrackingWidget"
        const val ACTION_STOP = "com.superproductivity.superproductivity.WIDGET_TRACKING_STOP"
        const val EXTRA_TASK_ID = "WIDGET_TRACKING_TASK_ID"

        private fun widgetIds(context: Context, appWidgetManager: AppWidgetManager): IntArray =
            appWidgetManager.getAppWidgetIds(
                ComponentName(context, TrackingWidgetProvider::class.java)
            )

        /** Reads the `currentTask` field from the same blob the task-list widget uses. */
        private fun currentTask(context: Context): WidgetCurrentTask? {
            return try {
                WidgetTrackingStopQueue.withoutPendingStop(
                    context,
                    WidgetData.parseCurrentTask(
                        (context.applicationContext as App).keyValStore
                            .get(WidgetData.KEYVAL_KEY, "{}")
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read widget data for tracking widget", e)
                null
            }
        }

        /** Called by Angular (via the JS bridge) after every `widget_data` push. */
        fun refreshAll(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val ids = widgetIds(context, appWidgetManager)
            if (ids.isEmpty()) {
                return
            }
            updateAll(context, appWidgetManager, ids)
        }

        private fun updateAll(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetIds: IntArray
        ) {
            val task = currentTask(context)
            for (appWidgetId in appWidgetIds) {
                updateWidget(context, appWidgetManager, appWidgetId, task)
            }
        }

        /** "on {device}, since {clock time}" — falls back to plain "on {device}" without a stamp. */
        private fun deviceLine(context: Context, task: WidgetCurrentTask): CharSequence {
            return task.sinceTs?.let { sinceTs ->
                context.getString(
                    R.string.widget_tracking_device_since,
                    task.deviceLabel,
                    DateUtils.formatDateTime(context, sinceTs, DateUtils.FORMAT_SHOW_TIME)
                )
            } ?: context.getString(R.string.widget_tracking_task_device, task.deviceLabel)
        }

        private fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            task: WidgetCurrentTask?
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_tracking)
            val style = WidgetBackground.styleFor(context, appWidgetId)
            style.applyBackground(views, R.id.widget_tracking_root)
            style.icon(views, R.id.widget_tracking_icon, WidgetInk.BRAND)
            style.icon(views, R.id.widget_tracking_stop, WidgetInk.MUTED)
            style.text(views, R.id.widget_tracking_title, WidgetInk.INK)
            style.text(views, R.id.widget_tracking_device, WidgetInk.MUTED)
            style.text(views, R.id.widget_tracking_focus, WidgetInk.MUTED)

            if (task != null) {
                views.setTextViewText(
                    R.id.widget_tracking_title,
                    context.getString(R.string.widget_tracking_task_title, task.title)
                )
                views.setTextViewText(R.id.widget_tracking_device, deviceLine(context, task))
            } else {
                views.setTextViewText(
                    R.id.widget_tracking_title,
                    context.getString(R.string.widget_not_tracking)
                )
                views.setTextViewText(R.id.widget_tracking_device, "")
            }

            if (task?.focusCycle != null) {
                views.setTextViewText(
                    R.id.widget_tracking_focus,
                    context.getString(R.string.widget_tracking_focus, task.focusCycle)
                )
                views.setViewVisibility(R.id.widget_tracking_focus, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.widget_tracking_focus, View.GONE)
            }

            if (task != null && task.isLocal) {
                views.setViewVisibility(R.id.widget_tracking_stop, View.VISIBLE)
                val stopIntent = Intent(context, TrackingWidgetProvider::class.java).apply {
                    action = ACTION_STOP
                    putExtra(EXTRA_TASK_ID, task.id)
                }
                val stopPendingIntent = PendingIntent.getBroadcast(
                    // Request code disambiguates from other broadcasts sharing this
                    // Intent target; the extra alone does not affect PendingIntent identity.
                    context, task.id.hashCode(), stopIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.widget_tracking_stop, stopPendingIntent)
            } else {
                views.setViewVisibility(R.id.widget_tracking_stop, View.GONE)
            }

            val openAppIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val openAppPendingIntent = PendingIntent.getActivity(
                context, 0, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_tracking_root, openAppPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
