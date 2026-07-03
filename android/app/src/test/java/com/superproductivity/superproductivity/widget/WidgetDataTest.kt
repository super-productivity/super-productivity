package com.superproductivity.superproductivity.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the native end of the `widget_data` v:1 contract. The writer-side shape is
 * locked by android-widget.selectors.spec.ts — if one changes, the other must too.
 */
class WidgetDataTest {

    private val blob =
        """
        {
          "v": 1,
          "tasks": [
            {"id": "t1", "title": "Task one", "isDone": false, "projectId": "p1"},
            {"id": "t2", "title": "Task two", "isDone": true},
            {"id": "t3", "title": "Task three", "isDone": false, "projectId": null}
          ],
          "projectColors": {"p1": "#ff0000"}
        }
        """.trimIndent()

    @Test
    fun parsesTasksWithProjectColors() {
        val tasks = WidgetData.parse(blob)
        assertEquals(3, tasks.size)
        assertEquals(WidgetTask("t1", "Task one", false, "#ff0000"), tasks[0])
        assertEquals(WidgetTask("t2", "Task two", true, null), tasks[1])
    }

    @Test
    fun jsonNullProjectIdDoesNotBecomeStringNull() {
        // org.json's optString maps JSON null to the literal string "null"
        val tasks = WidgetData.parse(blob)
        assertNull(tasks[2].projectColor)
    }

    @Test
    fun overlaysPendingDoneTargets() {
        val tasks = WidgetData.parse(blob, pendingDoneTargets = mapOf("t1" to true))
        assertTrue(tasks[0].isDone)
        assertTrue(tasks[1].isDone)
        assertEquals(false, tasks[2].isDone)
    }

    @Test
    fun overlaysPendingUndoneTargets() {
        // t2 is done in the blob but has a pending "mark undone" tap
        val tasks = WidgetData.parse(blob, pendingDoneTargets = mapOf("t2" to false))
        assertEquals(false, tasks[1].isDone)
    }

    @Test
    fun unknownVersionParsesToEmpty() {
        assertTrue(WidgetData.parse("""{"v": 2, "tasks": [{"id": "x"}]}""").isEmpty())
        assertTrue(WidgetData.parse("""{"tasks": []}""").isEmpty())
    }

    @Test
    fun emptyBlobParsesToEmpty() {
        assertTrue(WidgetData.parse("{}").isEmpty())
        assertTrue(WidgetData.parse("""{"v": 1}""").isEmpty())
    }

    @Test
    fun missingColorFallsBackToNull() {
        val json =
            """{"v":1,"tasks":[{"id":"a","title":"A","isDone":false,"projectId":"px"}],"projectColors":{}}"""
        assertNull(WidgetData.parse(json)[0].projectColor)
    }
}
