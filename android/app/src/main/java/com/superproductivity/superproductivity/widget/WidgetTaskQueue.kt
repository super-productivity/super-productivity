package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Manages a queue of tasks created from the home screen widget.
 * Tasks are stored in SharedPreferences and processed when the Angular app resumes.
 */
object WidgetTaskQueue {
    private const val PREFS_NAME = "SuperProductivityWidget"
    private const val KEY_TASK_QUEUE = "WIDGET_TASK_QUEUE"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /**
     * Add a task to the queue.
     * @return The generated task ID
     */
    @Synchronized
    fun addTask(context: Context, title: String): String {
        val taskId = UUID.randomUUID().toString()
        val task = JSONObject().apply {
            put("id", taskId)
            put("title", title.trim())
            put("createdAt", System.currentTimeMillis())
        }

        val prefs = getPrefs(context)
        val queueJson = prefs.getString(KEY_TASK_QUEUE, null)
        val queue = if (queueJson != null) {
            try {
                JSONObject(queueJson)
            } catch (e: Exception) {
                JSONObject().put("tasks", JSONArray())
            }
        } else {
            JSONObject().put("tasks", JSONArray())
        }

        val tasks = queue.optJSONArray("tasks") ?: JSONArray()
        tasks.put(task)
        queue.put("tasks", tasks)

        prefs.edit().putString(KEY_TASK_QUEUE, queue.toString()).apply()
        return taskId
    }

    /**
     * Get all queued tasks and clear the queue atomically.
     * @return JSON string of queued tasks, or null if empty
     */
    @Synchronized
    fun getAndClearQueue(context: Context): String? {
        val prefs = getPrefs(context)
        val queueJson = prefs.getString(KEY_TASK_QUEUE, null)

        if (queueJson != null) {
            prefs.edit().remove(KEY_TASK_QUEUE).commit()

            try {
                val queue = JSONObject(queueJson)
                val tasks = queue.optJSONArray("tasks")
                if (tasks != null && tasks.length() > 0) {
                    return queueJson
                }
            } catch (e: Exception) {
                // Invalid JSON, return null
            }
        }
        return null
    }
}
