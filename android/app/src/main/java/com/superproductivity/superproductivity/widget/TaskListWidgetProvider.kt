package com.superproductivity.superproductivity.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R

/**
 * Home screen widget listing today's tasks from the `widget_data` KeyValStore
 * snapshot pushed by Angular. Checkbox taps enqueue the task ID in
 * [WidgetDoneQueue]; Angular drains the queue (instantly via the local drain
 * broadcast when alive, otherwise on next resume/cold start).
 */
class TaskListWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId)
        }
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
                // Re-render so the pending-done overlay shows the checked box
                notifyDataChanged(context)
                // Contentless "drain now" signal for a live app; Angular always
                // pulls the IDs from the queue itself (single delivery path).
                LocalBroadcastManager.getInstance(context)
                    .sendBroadcast(Intent(ACTION_WIDGET_DONE_DRAIN))
            }

            intent.getBooleanExtra(EXTRA_OPEN_APP, false) -> {
                try {
                    context.startActivity(
                        Intent(context, CapacitorMainActivity::class.java).apply {
                            flags =
                                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                        }
                    )
                } catch (e: Exception) {
                    // Background-activity-launch restrictions may block this on some
                    // API levels/OEMs; the header tap (direct activity PendingIntent)
                    // remains as the reliable way in.
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
        const val EXTRA_TASK_ID = "WIDGET_TASK_ID"
        const val EXTRA_SET_DONE = "WIDGET_SET_DONE"
        const val EXTRA_OPEN_APP = "WIDGET_OPEN_APP"

        fun notifyDataChanged(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val widgetIds = appWidgetManager.getAppWidgetIds(
                ComponentName(context, TaskListWidgetProvider::class.java)
            )
            appWidgetManager.notifyAppWidgetViewDataChanged(widgetIds, R.id.widget_task_list)
        }

        private fun updateWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_task_list)

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
            views.setOnClickPendingIntent(R.id.widget_header, openAppPendingIntent)
            views.setOnClickPendingIntent(R.id.widget_empty, openAppPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
