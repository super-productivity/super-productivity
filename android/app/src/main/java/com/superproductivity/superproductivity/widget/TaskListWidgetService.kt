package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.util.Log
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.R

class TaskListWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return TaskListRemoteViewsFactory(applicationContext)
    }
}

private class TaskListRemoteViewsFactory(
    private val context: Context
) : RemoteViewsService.RemoteViewsFactory {

    private var tasks: List<WidgetTask> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        tasks = try {
            val json = (context.applicationContext as App).keyValStore
                .get(WidgetData.KEYVAL_KEY, "{}")
            WidgetData.parse(json, WidgetDoneQueue.peek(context)).take(MAX_TASKS)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse widget data", e)
            emptyList()
        }
    }

    override fun onDestroy() {
        tasks = emptyList()
    }

    override fun getCount(): Int = tasks.size

    override fun getViewAt(position: Int): RemoteViews {
        val rv = RemoteViews(context.packageName, R.layout.widget_task_row)

        if (position >= tasks.size) {
            return rv
        }

        val task = tasks[position]
        rv.setTextViewText(R.id.widget_task_title, task.title)
        rv.setImageViewResource(
            R.id.widget_done_checkbox,
            if (task.isDone) {
                android.R.drawable.checkbox_on_background
            } else {
                android.R.drawable.checkbox_off_background
            }
        )

        val color = try {
            task.projectColor?.let { Color.parseColor(it) } ?: DEFAULT_DOT_COLOR
        } catch (e: Exception) {
            DEFAULT_DOT_COLOR
        }
        rv.setInt(R.id.widget_project_dot, "setBackgroundColor", color)

        rv.setOnClickFillInIntent(
            R.id.widget_done_checkbox,
            Intent().putExtra(TaskListWidgetProvider.EXTRA_TASK_ID, task.id)
        )
        rv.setOnClickFillInIntent(
            R.id.widget_task_title,
            Intent().putExtra(TaskListWidgetProvider.EXTRA_OPEN_APP, true)
        )

        return rv
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false

    companion object {
        private const val TAG = "TaskListWidget"
        private const val MAX_TASKS = 20
        private const val DEFAULT_DOT_COLOR = 0xFF2196F3.toInt()
    }
}
