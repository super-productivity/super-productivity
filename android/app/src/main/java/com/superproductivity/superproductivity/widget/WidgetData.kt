package com.superproductivity.superproductivity.widget

import org.json.JSONObject

data class WidgetTask(
    val id: String,
    val title: String,
    val isDone: Boolean,
    val projectColor: String?
)

/**
 * Native end of the `widget_data` KeyValStore contract. The writer is Angular's
 * WidgetDataService; the blob shape is defined by AndroidWidgetData in
 * src/app/features/android/android-widget.model.ts — keep both ends in sync and
 * bump `v` on breaking changes.
 */
object WidgetData {
    const val KEYVAL_KEY = "widget_data"
    private const val SUPPORTED_VERSION = 1

    /**
     * @param pendingDoneIds IDs queued via [WidgetDoneQueue] but not yet applied by
     * Angular — overlaid as done so a checkbox tap is reflected immediately even
     * while the app process is dead.
     */
    fun parse(json: String, pendingDoneIds: Set<String> = emptySet()): List<WidgetTask> {
        val root = JSONObject(json)
        if (root.optInt("v", -1) != SUPPORTED_VERSION) {
            return emptyList()
        }
        val tasksArray = root.optJSONArray("tasks") ?: return emptyList()
        val projectColors = root.optJSONObject("projectColors")
        val result = mutableListOf<WidgetTask>()
        for (i in 0 until tasksArray.length()) {
            val task = tasksArray.getJSONObject(i)
            val id = task.getString("id")
            // isNull guard: optString maps JSON null to the literal string "null"
            val projectId =
                if (task.isNull("projectId")) null else task.optString("projectId", null)
            val color = projectId?.let { pId ->
                projectColors?.takeIf { !it.isNull(pId) }?.optString(pId, null)
            }
            result.add(
                WidgetTask(
                    id = id,
                    title = task.getString("title"),
                    isDone = task.optBoolean("isDone", false) || pendingDoneIds.contains(id),
                    projectColor = color
                )
            )
        }
        return result
    }
}
