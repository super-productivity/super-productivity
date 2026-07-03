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
        rv.setTextColor(
            R.id.widget_task_title,
            context.getColor(if (task.isDone) R.color.widget_ink_muted else R.color.widget_ink)
        )
        rv.setImageViewResource(
            R.id.widget_done_checkbox,
            if (task.isDone) R.drawable.ic_widget_check_done else R.drawable.ic_widget_check_outline
        )

        // Project dot: tint with the project color, hide entirely for
        // project-less tasks instead of showing a meaningless default color
        val color = task.projectColor?.let {
            try {
                Color.parseColor(it)
            } catch (e: Exception) {
                null
            }
        }
        if (color != null) {
            rv.setViewVisibility(R.id.widget_project_dot, android.view.View.VISIBLE)
            rv.setInt(R.id.widget_project_dot, "setColorFilter", color)
        } else {
            rv.setViewVisibility(R.id.widget_project_dot, android.view.View.GONE)
        }

        // Checkbox toggles to the opposite of the DISPLAYED state; anywhere else
        // on the row opens the app.
        rv.setOnClickFillInIntent(
            R.id.widget_done_checkbox,
            Intent()
                .putExtra(TaskListWidgetProvider.EXTRA_TASK_ID, task.id)
                .putExtra(TaskListWidgetProvider.EXTRA_SET_DONE, !task.isDone)
        )
        rv.setOnClickFillInIntent(
            R.id.widget_task_row,
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
    }
}
