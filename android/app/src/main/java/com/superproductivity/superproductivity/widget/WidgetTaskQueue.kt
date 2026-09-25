package com.superproductivity.superproductivity.widget

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/**
 * Legacy SharedPreferences queue used by the startup overlay before [CaptureInbox].
 * Kept only to move entries left behind by an older app version into the inbox.
 */
object WidgetTaskQueue {
    private const val PREFS_NAME = "SuperProductivityWidget"
    private const val KEY_TASK_QUEUE = "WIDGET_TASK_QUEUE"

    data class LegacyTask(val id: String, val title: String, val createdAt: Long)

    /**
     * Copies legacy entries into [inbox], then clears the legacy key. Re-running after
     * a partial failure is safe: entries keep their id, so a copy just overwrites itself.
     */
    @Synchronized
    fun migrateInto(context: Context, inbox: CaptureInbox) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val queueJson = prefs.getString(KEY_TASK_QUEUE, null) ?: return
        for (task in parseLegacy(queueJson)) {
            inbox.add(task.title, "overlay", task.createdAt, task.id)
        }
        prefs.edit().remove(KEY_TASK_QUEUE).commit()
    }

    fun parseLegacy(queueJson: String): List<LegacyTask> {
        val tasks = try {
            JSONObject(queueJson).optJSONArray("tasks")
        } catch (e: Exception) {
            null
        } ?: return emptyList()
        return (0 until tasks.length()).mapNotNull { i ->
            val task = tasks.optJSONObject(i) ?: return@mapNotNull null
            val title = task.optString("title").trim()
            if (title.isEmpty()) return@mapNotNull null
            val legacyId = task.optString("id")
            LegacyTask(
                id = if (CaptureInbox.isValidId(legacyId)) legacyId else UUID.randomUUID().toString(),
                title = title,
                createdAt = task.optLong("createdAt", System.currentTimeMillis()),
            )
        }
    }
}
