package com.superproductivity.superproductivity.widget

import android.appwidget.AppWidgetManager
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
        // One factory per widget instance: the adapter intent carries the widget id
        // (and a Uri unique to it), and each instance may show a different source.
        return TaskListRemoteViewsFactory(
            applicationContext,
            intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID
            )
        )
    }
}

private class TaskListRemoteViewsFactory(
    private val context: Context,
    private val appWidgetId: Int
) : RemoteViewsService.RemoteViewsFactory {

    private var tasks: List<WidgetTask> = emptyList()

    /** The project a row tap opens; null on a Today widget. */
    private var projectIdToOpen: String? = null

    override fun onCreate() {}

    override fun onDataSetChanged() {
        projectIdToOpen = null
        val snapshot = try {
            val json = (context.applicationContext as App).keyValStore
                .get(WidgetData.KEYVAL_KEY, "{}")
            val selectedProjectId = TaskListWidgetProvider.selectedProjectId(context, appWidgetId)
            // Same check as the header, so rows and header fall back to Today together.
            projectIdToOpen = selectedProjectId?.takeIf {
                WidgetData.projectTitle(json, it) != null
            }
            WidgetData.parse(
                json,
                WidgetDoneQueue.peek(context),
                projectIdToOpen,
                WidgetDoneQueue.peekDoneTapTimes(context)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse widget data", e)
            emptyList()
        }
        // Separate try: an unreadable inbox must not hide the snapshot's tasks.
        tasks = try {
            WidgetData.withPendingCaptures(
                snapshot,
                CaptureInbox.forContext(context).pendingJson(),
                projectIdToOpen
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read pending quick adds", e)
            snapshot
        }.take(MAX_TASKS)
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
        // on the row opens the widget's list in the app (its project, or Today).
        // A pending quick add has no task to toggle yet, so its checkbox opens
        // the list too, and the app imports the task there. The label names the
        // task and the outcome: every row's checkbox would otherwise read the
        // same to a screen reader.
        val openList = Intent().apply {
            putExtra(TaskListWidgetProvider.EXTRA_OPEN_APP, true)
            projectIdToOpen?.let {
                putExtra(TaskListWidgetProvider.EXTRA_OPEN_PROJECT_ID, it)
            }
        }
        val action = WidgetData.checkboxActionFor(task)
        rv.setOnClickFillInIntent(
            R.id.widget_done_checkbox,
            when (action) {
                WidgetCheckboxAction.OPEN_APP -> openList
                WidgetCheckboxAction.MARK_DONE, WidgetCheckboxAction.MARK_UNDONE ->
                    Intent()
                        .putExtra(TaskListWidgetProvider.EXTRA_TASK_ID, task.id)
                        .putExtra(
                            TaskListWidgetProvider.EXTRA_SET_DONE,
                            action == WidgetCheckboxAction.MARK_DONE
                        )
            }
        )
        rv.setContentDescription(
            R.id.widget_done_checkbox,
            context.getString(
                when (action) {
                    WidgetCheckboxAction.MARK_DONE -> R.string.widget_task_mark_done
                    WidgetCheckboxAction.MARK_UNDONE -> R.string.widget_task_mark_undone
                    WidgetCheckboxAction.OPEN_APP -> R.string.widget_task_open_pending
                },
                task.title
            )
        )
        rv.setOnClickFillInIntent(R.id.widget_task_row, openList)

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
