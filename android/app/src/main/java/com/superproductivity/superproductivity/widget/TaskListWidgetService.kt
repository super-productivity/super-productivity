package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.util.Log
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.R
import org.json.JSONObject

class TaskListWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return TaskListRemoteViewsFactory(applicationContext)
    }
}

private data class WidgetTask(
    val id: String,
    val title: String,
    val isDone: Boolean,
    val projectId: String?,
    val projectColor: String?
)

private class TaskListRemoteViewsFactory(
    private val context: Context
) : RemoteViewsService.RemoteViewsFactory {

    private var tasks: List<WidgetTask> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        try {
            val json = (context.applicationContext as App).keyValStore.get("widget_data", "{}")
            val root = JSONObject(json)
            val tasksArray = root.optJSONArray("tasks") ?: return
            val projects = root.optJSONObject("projects")

            val loaded = mutableListOf<WidgetTask>()
            val limit = minOf(tasksArray.length(), 20)
            for (i in 0 until limit) {
                val task = tasksArray.getJSONObject(i)
                val projectId = task.optString("projectId", null)
                val projectColor = if (projectId != null && projects != null) {
                    projects.optJSONObject(projectId)?.optString("color", null)
                } else null

                loaded.add(
                    WidgetTask(
                        id = task.getString("id"),
                        title = task.getString("title"),
                        isDone = task.optBoolean("isDone", false),
                        projectId = projectId,
                        projectColor = projectColor
                    )
                )
            }
            tasks = loaded
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse widget data", e)
            tasks = emptyList()
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

        if (task.isDone) {
            rv.setImageViewResource(R.id.widget_done_checkbox, android.R.drawable.checkbox_on_background)
        } else {
            rv.setImageViewResource(R.id.widget_done_checkbox, android.R.drawable.checkbox_off_background)
        }

        val color = try {
            if (task.projectColor != null) Color.parseColor(task.projectColor) else DEFAULT_DOT_COLOR
        } catch (e: Exception) {
            DEFAULT_DOT_COLOR
        }
        rv.setInt(R.id.widget_project_dot, "setBackgroundColor", color)

        val fillInIntent = Intent().apply {
            putExtra(TaskListWidgetProvider.EXTRA_TASK_ID, task.id)
        }
        rv.setOnClickFillInIntent(R.id.widget_done_checkbox, fillInIntent)

        val openIntent = Intent().apply {
            putExtra(TaskListWidgetProvider.EXTRA_OPEN_APP, true)
        }
        rv.setOnClickFillInIntent(R.id.widget_task_title, openIntent)

        return rv
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = false

    companion object {
        private const val TAG = "TaskListWidget"
        private const val DEFAULT_DOT_COLOR = 0xFF2196F3.toInt()
    }
}
