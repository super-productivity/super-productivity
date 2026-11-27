package com.superproductivity.superproductivity.service

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Repeat-config ops the worker already downloads fold into the schedule cache.
 * They must not change which task reminders that same page schedules.
 */
class RepeatCfgSyncTest {

    private val provider = SuperSyncBackgroundProvider(null)

    private val daily = JSONObject()
        .put("id", "cfg")
        .put("title", "Standup")
        .put("repeatCycle", "DAILY")
        .put("repeatEvery", 1)
        .put("startTime", "09:00")
        .put("remindAt", "AtStart")
        .put("startDate", "2026-01-01")
        .put("projectId", "p1")

    @Test
    fun `create then pause delete and delete-instance`() {
        val created = provider.parseResponse(page(createOp(daily)))
        assertTrue(created.remindersToSchedule.isEmpty())
        val cfg = created.nextRepeatState.byId("cfg")!!
        assertTrue(cfg.isComplete)
        assertTrue(cfg.isArmable())
        assertEquals("Standup", cfg.title)

        val paused = provider.parseResponse(
            page(updateOp("cfg", JSONObject().put("isPaused", true))),
            created.nextRepeatState,
        )
        assertFalse(paused.nextRepeatState.byId("cfg")!!.isArmable())
        assertEquals(setOf("cfg"), paused.repeatCfgIdsRemoved)
        assertTrue(paused.isAlarmStale("rpt_cfg_2026-06-16", 1L, "TASK"))
        assertFalse(paused.isAlarmStale("rpt_other_2026-06-16", 1L, "TASK"))

        val deleted = provider.parseResponse(
            page(op("DEL", "[TaskRepeatCfg] Delete TaskRepeatCfg", "cfg", null)),
            paused.nextRepeatState,
        )
        assertEquals(null, deleted.nextRepeatState.byId("cfg"))
        assertTrue("cfg" in deleted.repeatCfgIdsRemoved)

        val again = provider.parseResponse(page(createOp(daily)))
        val once = provider.parseResponse(
            page(
                op(
                    "UPD",
                    "[TaskRepeatCfg] Delete Single Instance",
                    "cfg",
                    action(JSONObject().put("repeatCfgId", "cfg").put("dateStr", "2026-06-16")),
                ),
            ),
            again.nextRepeatState,
        )
        val twice = provider.parseResponse(
            page(
                op(
                    "UPD",
                    "[TaskRepeatCfg] Delete Single Instance",
                    "cfg",
                    action(JSONObject().put("repeatCfgId", "cfg").put("dateStr", "2026-06-16")),
                ),
            ),
            once.nextRepeatState,
        )
        assertEquals(listOf("2026-06-16"), twice.nextRepeatState.byId("cfg")!!.deletedInstanceDates)
    }

    @Test
    fun `a partial update of an unknown config is not armed`() {
        val result = provider.parseResponse(
            page(updateOp("missing", JSONObject().put("startTime", "09:00"))),
        )
        val cfg = result.nextRepeatState.byId("missing")!!
        assertFalse(cfg.isComplete)
        assertFalse(cfg.isArmable())
        assertTrue(result.repeatCfgIdsRemoved.isEmpty())
    }

    @Test
    fun `LWW replace becomes a complete config and a cleared remindAt is removed`() {
        val replaced = provider.parseResponse(
            page(
                op(
                    "UPD",
                    "[TASK_REPEAT_CFG] LWW Update",
                    "cfg",
                    JSONObject()
                        .put("actionPayload", daily)
                        .put("entityChanges", JSONArray())
                        .put("lwwUpdateMode", "replace"),
                ),
            ),
        )
        assertTrue(replaced.nextRepeatState.byId("cfg")!!.isArmable())

        val cleared = provider.parseResponse(
            page(
                updateOp(
                    "cfg",
                    JSONObject(),
                    cleared = JSONArray().put("remindAt"),
                ),
            ),
            replaced.nextRepeatState,
        )
        assertEquals(null, cleared.nextRepeatState.byId("cfg")!!.remindAt)
        assertTrue("cfg" in cleared.repeatCfgIdsRemoved)
    }

    @Test
    fun `archiving a project disarms its configs and a missing ops array keeps state`() {
        val created = provider.parseResponse(page(createOp(daily))).nextRepeatState
        val archived = provider.parseResponse(
            page(
                op(
                    "UPD",
                    "[Project] Archive Project",
                    "p1",
                    action(JSONObject().put("id", "p1")),
                    entityType = "PROJECT",
                ),
            ),
            created,
        )
        assertTrue("p1" in archived.nextRepeatState.archivedProjectIds)
        assertTrue("cfg" in archived.repeatCfgIdsRemoved)

        val kept = provider.parseResponse("""{"latestSeq":9}""", archived.nextRepeatState)
        assertEquals(9L, kept.latestSeq)
        assertEquals(archived.nextRepeatState, kept.nextRepeatState)
        assertTrue(kept.remindersToSchedule.isEmpty())
    }

    @Test
    fun `deleting a project removes its configs and keeps others`() {
        val other = JSONObject(daily.toString()).put("id", "other").put("projectId", "p2")
        val created = provider.parseResponse(page(createOp(daily), createOp(other))).nextRepeatState
        val deleted = provider.parseResponse(
            page(
                op(
                    "DEL",
                    "[Task Shared] deleteProject",
                    "p1",
                    action(JSONObject().put("projectId", "p1")),
                    entityType = "PROJECT",
                ),
            ),
            created,
        )
        assertEquals(null, deleted.nextRepeatState.byId("cfg"))
        assertTrue(deleted.nextRepeatState.byId("other")!!.isArmable())
        assertEquals(setOf("cfg"), deleted.repeatCfgIdsRemoved)
        assertTrue(deleted.isAlarmStale("rpt_cfg_2026-06-16", 1L, "TASK"))
    }

    @Test
    fun `deleting tags removes tag-only configs and strips the tag from the rest`() {
        val tagOnlyCfg = JSONObject(daily.toString())
        tagOnlyCfg.remove("projectId")
        tagOnlyCfg.put("id", "tagOnly").put("tagIds", JSONArray().put("t1"))
        val twoTags = JSONObject(daily.toString()).put("id", "twoTags")
        twoTags.remove("projectId")
        twoTags.put("tagIds", JSONArray().put("t1").put("t2"))
        val withProject = JSONObject(daily.toString()).put("id", "withProject")
            .put("tagIds", JSONArray().put("t1"))
        val created = provider.parseResponse(
            page(createOp(tagOnlyCfg), createOp(twoTags), createOp(withProject)),
        ).nextRepeatState
        assertEquals(listOf("t1", "t2"), created.byId("twoTags")!!.tagIds)

        val single = provider.parseResponse(
            page(op("DEL", "[Tag] Delete Tag", "t1", action(JSONObject().put("id", "t1")), entityType = "TAG")),
            created,
        )
        assertEquals(null, single.nextRepeatState.byId("tagOnly"))
        assertEquals(listOf("t2"), single.nextRepeatState.byId("twoTags")!!.tagIds)
        assertEquals(emptyList<String>(), single.nextRepeatState.byId("withProject")!!.tagIds)
        assertTrue(single.nextRepeatState.byId("withProject")!!.isArmable())
        assertEquals(setOf("tagOnly"), single.repeatCfgIdsRemoved)

        val bulk = provider.parseResponse(
            page(
                op("DEL", "[Tag] Delete multiple Tags", "", null, entityType = "TAG")
                    .put("entityIds", JSONArray().put("t1").put("t2")),
            ),
            created,
        )
        assertEquals(null, bulk.nextRepeatState.byId("tagOnly"))
        assertEquals(null, bulk.nextRepeatState.byId("twoTags"))
        assertTrue(bulk.nextRepeatState.byId("withProject") != null)
        assertEquals(setOf("tagOnly", "twoTags"), bulk.repeatCfgIdsRemoved)
    }

    @Test
    fun `a full-state import keeps cached configs armed`() {
        val created = provider.parseResponse(page(createOp(daily))).nextRepeatState
        val imported = provider.parseResponse(
            page(op("SYNC_IMPORT", "[SP_ALL] Load(import) all data", "x", null, entityType = "ALL")),
            created,
        )
        assertTrue(imported.nextRepeatState.byId("cfg")!!.isArmable())
        assertTrue(imported.repeatCfgIdsRemoved.isEmpty())
        assertFalse(imported.isAlarmStale("rpt_cfg_2026-06-16", 1L, "TASK"))
    }

    @Test
    fun `a task reminder at the same occurrence id is not stale`() {
        val created = provider.parseResponse(page(createOp(daily)))
        val paused = provider.parseResponse(
            page(updateOp("cfg", JSONObject().put("isPaused", true))),
            created.nextRepeatState,
        )
        val withTask = paused.copy(
            remindersToSchedule = listOf(
                ReminderToSchedule("rpt_cfg_2026-06-16", "Standup", 50L, false),
            ),
        )
        assertFalse(withTask.isAlarmStale("rpt_cfg_2026-06-16", 50L, "TASK"))
        assertTrue(withTask.isAlarmStale("rpt_cfg_2026-06-17", 50L, "TASK"))
    }

    @Test
    fun `pausing a series leaves the alarms of instances it already created`() {
        val created = provider.parseResponse(
            page(createOp(JSONObject(daily.toString()).put("lastTaskCreationDay", "2026-06-16"))),
        )
        val paused = provider.parseResponse(
            page(updateOp("cfg", JSONObject().put("isPaused", true))),
            created.nextRepeatState,
        )
        // The existing task keeps its own deadline and reminder.
        assertFalse(paused.isAlarmStale("rpt_cfg_2026-06-16", 50L, "DEADLINE"))
        assertFalse(paused.isAlarmStale("rpt_cfg_2026-06-16", 50L, "TASK"))
        // A pre-scheduled future occurrence goes.
        assertTrue(paused.isAlarmStale("rpt_cfg_2026-06-17", 50L, "TASK"))
    }

    @Test
    fun `deleting a series leaves the alarms of instances it already created`() {
        val created = provider.parseResponse(
            page(createOp(JSONObject(daily.toString()).put("lastTaskCreationDay", "2026-06-16"))),
        )
        val deleted = provider.parseResponse(
            page(op("DEL", "[TaskRepeatCfg] Delete TaskRepeatCfg", "cfg", null)),
            created.nextRepeatState,
        )
        // The app detaches the existing task and keeps its reminder.
        assertFalse(deleted.isAlarmStale("rpt_cfg_2026-06-16", 50L, "TASK"))
        // A pre-scheduled future occurrence goes.
        assertTrue(deleted.isAlarmStale("rpt_cfg_2026-06-17", 50L, "TASK"))
    }

    private fun createOp(cfg: JSONObject) = op(
        "CRT",
        "[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task",
        cfg.getString("id"),
        action(JSONObject().put("taskRepeatCfg", cfg)),
    )

    private fun updateOp(id: String, changes: JSONObject, cleared: JSONArray? = null): JSONObject {
        val actionPayload = JSONObject().put(
            "taskRepeatCfg",
            JSONObject().put("id", id).put("changes", changes),
        )
        if (cleared != null) actionPayload.put("clearedFields", cleared)
        return op("UPD", "[TaskRepeatCfg] Update TaskRepeatCfg", id, action(actionPayload))
    }

    private fun action(actionPayload: JSONObject) =
        JSONObject().put("actionPayload", actionPayload).put("entityChanges", JSONArray())

    private fun op(
        opType: String,
        actionType: String,
        entityId: String,
        payload: JSONObject?,
        entityType: String = "TASK_REPEAT_CFG",
    ): JSONObject {
        val op = JSONObject()
            .put("opType", opType)
            .put("actionType", actionType)
            .put("entityType", entityType)
            .put("entityId", entityId)
        if (payload != null) op.put("payload", payload)
        return op
    }

    private fun page(vararg ops: JSONObject) = JSONObject()
        .put(
            "ops",
            JSONArray().apply {
                ops.forEachIndexed { i, op -> put(JSONObject().put("op", op).put("serverSeq", i + 1)) }
            },
        )
        .put("latestSeq", 1)
        .put("hasMore", false)
        .toString()
}
