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
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.R
import org.json.JSONObject

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

        when (intent.action) {
            ACTION_MARK_DONE -> {
                val taskId = intent.getStringExtra(EXTRA_TASK_ID) ?: return
                Log.d(TAG, "Mark done from widget: taskId=$taskId")

                WidgetDoneQueue.addTaskId(context, taskId)
                markDoneInWidgetData(context, taskId)

                // Refresh widget to show updated state
                val appWidgetManager = AppWidgetManager.getInstance(context)
                val widgetIds = appWidgetManager.getAppWidgetIds(
                    ComponentName(context, TaskListWidgetProvider::class.java)
                )
                appWidgetManager.notifyAppWidgetViewDataChanged(widgetIds, R.id.widget_task_list)

                // Notify app if alive via LocalBroadcast
                val localIntent = Intent(ACTION_WIDGET_DONE_LOCAL).apply {
                    putExtra(EXTRA_TASK_ID, taskId)
                }
                LocalBroadcastManager.getInstance(context).sendBroadcast(localIntent)
            }
            ACTION_OPEN_APP -> {
                val openIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                context.startActivity(openIntent)
            }
        }
    }

    private fun markDoneInWidgetData(context: Context, taskId: String) {
        try {
            val store = (context.applicationContext as App).keyValStore
            val json = store.get("widget_data", "{}")
            val root = JSONObject(json)
            val tasks = root.optJSONArray("tasks") ?: return
            for (i in 0 until tasks.length()) {
                val task = tasks.getJSONObject(i)
                if (task.getString("id") == taskId) {
                    task.put("isDone", true)
                    break
                }
            }
            store.set("widget_data", root.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to update widget_data for done task", e)
        }
    }

    companion object {
        private const val TAG = "TaskListWidget"
        const val ACTION_MARK_DONE = "com.superproductivity.superproductivity.WIDGET_MARK_DONE"
        const val ACTION_OPEN_APP = "com.superproductivity.superproductivity.WIDGET_OPEN_APP"
        const val ACTION_WIDGET_DONE_LOCAL = "com.superproductivity.superproductivity.WIDGET_DONE_LOCAL"
        const val EXTRA_TASK_ID = "WIDGET_TASK_ID"
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

            // Set up the RemoteViews adapter for the ListView
            val serviceIntent = Intent(context, TaskListWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.widget_task_list, serviceIntent)
            views.setEmptyView(R.id.widget_task_list, R.id.widget_empty)

            // PendingIntent template for done checkbox clicks
            val doneIntent = Intent(context, TaskListWidgetProvider::class.java).apply {
                action = ACTION_MARK_DONE
            }
            val donePendingIntent = PendingIntent.getBroadcast(
                context, 0, doneIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            views.setPendingIntentTemplate(R.id.widget_task_list, donePendingIntent)

            // Header tap → open app
            val openAppIntent = Intent(context, CapacitorMainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val openAppPendingIntent = PendingIntent.getActivity(
                context, 0, openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_header, openAppPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
