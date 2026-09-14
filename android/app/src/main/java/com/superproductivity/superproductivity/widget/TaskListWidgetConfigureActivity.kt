package com.superproductivity.superproductivity.widget

import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.superproductivity.superproductivity.App
import com.superproductivity.superproductivity.R

/** Minimal per-instance source picker for the Android home-screen task widget. */
class TaskListWidgetConfigureActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)

        val appWidgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        )
        val appWidgetManager = AppWidgetManager.getInstance(this)
        if (
            appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID ||
            appWidgetManager.getAppWidgetInfo(appWidgetId)?.provider !=
                ComponentName(this, TaskListWidgetProvider::class.java)
        ) {
            finish()
            return
        }

        val projects = try {
            WidgetData.parseProjects(
                (applicationContext as App).keyValStore.get(WidgetData.KEYVAL_KEY, "{}")
            )
        } catch (_: Exception) {
            emptyList()
        }
        val selectedProjectId = TaskListWidgetProvider.selectedProjectId(this, appWidgetId)
        val labels = listOf(getString(R.string.widget_header_title)) + projects.map { it.title }
        val checkedItem = projects.indexOfFirst { it.id == selectedProjectId }.let {
            if (it < 0) 0 else it + 1
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.widget_configure_title)
            .setSingleChoiceItems(labels.toTypedArray(), checkedItem) { _, which ->
                TaskListWidgetProvider.setSelectedProjectId(
                    this,
                    appWidgetId,
                    projects.getOrNull(which - 1)?.id
                )
                TaskListWidgetProvider.refresh(this, appWidgetId)
                setResult(
                    RESULT_OK,
                    Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                )
                finish()
            }
            .setOnCancelListener { finish() }
            .show()
    }
}
