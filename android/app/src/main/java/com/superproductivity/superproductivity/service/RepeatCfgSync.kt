package com.superproductivity.superproductivity.service

import org.json.JSONArray
import org.json.JSONObject

/**
 * Folds repeat-config and project-archive ops the worker has already
 * downloaded into the local schedule cache. No extra request: these are the
 * same SuperSync operations [SuperSyncBackgroundProvider] parses for `remindAt`.
 *
 * Action strings are the NgRx types in task-repeat-cfg.actions.ts and
 * project.actions.ts. A type missing here is ignored, the same way an unknown
 * task action is ignored, until the app is opened and mirrors its configs
 * (RepeatReminderCache.replaceFromApp).
 */
internal object RepeatCfgSync {
    private const val ACTION_ADD = "[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task"
    private const val ACTION_UPDATE = "[TaskRepeatCfg] Update TaskRepeatCfg"
    private const val ACTION_UPDATE_MANY = "[TaskRepeatCfg] Update multiple TaskRepeatCfgs"
    private const val ACTION_DELETE = "[TaskRepeatCfg] Delete TaskRepeatCfg"
    private const val ACTION_DELETE_MANY = "[TaskRepeatCfg] Delete multiple TaskRepeatCfgs"
    private const val ACTION_DELETE_INSTANCE = "[TaskRepeatCfg] Delete Single Instance"
    private const val ACTION_LWW = "[TASK_REPEAT_CFG] LWW Update"
    private const val ACTION_ARCHIVE_PROJECT = "[Project] Archive Project"
    private const val ACTION_UNARCHIVE_PROJECT = "[Project] Unarchive Project"
    private const val ACTION_COMPLETE_PROJECT = "[Project] Complete Project"
    private const val ACTION_REOPEN_PROJECT = "[Project] Reopen Project"
    private const val ACTION_UPDATE_PROJECT = "[Project] Update Project"
    private const val ACTION_PROJECT_LWW = "[PROJECT] LWW Update"
    // Full-state imports (entityType ALL) are not folded: emptying the cache
    // would silently stop every repeat alarm until the app is opened, while
    // keeping it risks only a stale alarm that the next app snapshot removes.
    val ENTITY_TYPES = setOf("TASK_REPEAT_CFG", "PROJECT", "TAG")

    /** Lazy [payload]: tag and project deletes are read from the envelope alone. */
    fun fold(
        state: RepeatCfgSyncState,
        op: JSONObject,
        payload: Lazy<JSONObject?>,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        val entityType = op.optString("entityType", "")
        val actionType = op.optString("actionType", "")
        val opType = op.optString("opType", "")
        if (entityType == "TAG") {
            return if (opType == "DEL") state.deleteTags(entityIds(op, null).toSet(), removed) else state
        }
        if (entityType == "PROJECT") {
            if (opType == "DEL") return state.deleteProject(op.optString("entityId", ""), removed)
            return foldProject(state, op, payload.value, actionType, removed)
        }
        if (entityType != "TASK_REPEAT_CFG") return state

        if (opType == "DEL" || actionType == ACTION_DELETE || actionType == ACTION_DELETE_MANY) {
            var next = state
            for (id in entityIds(op, payload.value)) {
                next = next.remove(id)
                removed.add(id)
            }
            return next
        }

        val resolved = payload.value
        val actionPayload = resolved?.optJSONObject("actionPayload")
        return when (actionType) {
            ACTION_ADD -> upsertSnapshot(state, actionPayload?.optJSONObject("taskRepeatCfg"), removed)
            ACTION_UPDATE -> applyUpdate(state, actionPayload, resolved, removed)
            ACTION_UPDATE_MANY -> applyBulkUpdate(state, actionPayload, removed)
            ACTION_DELETE_INSTANCE -> deleteInstance(state, actionPayload)
            ACTION_LWW -> applyLww(state, op, resolved, actionPayload, removed)
            else -> state
        }
    }

    private fun foldProject(
        state: RepeatCfgSyncState,
        op: JSONObject,
        payload: JSONObject?,
        actionType: String,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        val id = op.optString("entityId", "")
        return when (actionType) {
            ACTION_ARCHIVE_PROJECT, ACTION_COMPLETE_PROJECT -> {
                state.cfgs.filter { it.projectId == id }.forEach { removed.add(it.id) }
                state.archive(id)
            }
            ACTION_UNARCHIVE_PROJECT, ACTION_REOPEN_PROJECT -> state.unarchive(id)
            ACTION_UPDATE_PROJECT -> {
                val changes = payload?.optJSONObject("actionPayload")
                    ?.optJSONObject("project")
                    ?.optJSONObject("changes")
                applyArchivedFlag(state, id, changes, removed)
            }
            ACTION_PROJECT_LWW -> {
                val entity = payload?.optJSONObject("actionPayload")
                val entityId = entity?.optString("id", "").orEmpty().ifEmpty { id }
                applyArchivedFlag(state, entityId, entity, removed)
            }
            else -> state
        }
    }

    private fun applyArchivedFlag(
        state: RepeatCfgSyncState,
        id: String,
        fields: JSONObject?,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        if (id.isEmpty() || fields == null || !fields.has("isArchived") || fields.isNull("isArchived")) return state
        return if (fields.optBoolean("isArchived", false)) {
            state.cfgs.filter { it.projectId == id }.forEach { removed.add(it.id) }
            state.archive(id)
        } else {
            state.unarchive(id)
        }
    }

    private fun upsertSnapshot(
        state: RepeatCfgSyncState,
        obj: JSONObject?,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        val cfg = obj?.let { RepeatCfg.fromJson(it, complete = true) } ?: return state
        noteArmable(cfg.id, state.byId(cfg.id), cfg, explicitOff = false, removed)
        return state.upsert(cfg)
    }

    private fun applyUpdate(
        state: RepeatCfgSyncState,
        actionPayload: JSONObject?,
        payload: JSONObject?,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        val update = actionPayload?.optJSONObject("taskRepeatCfg") ?: return state
        val id = update.optString("id", "")
        val changes = update.optJSONObject("changes") ?: return state
        if (id.isEmpty()) return state
        return merge(state, id, changes, clearedFields(actionPayload) + clearedFields(payload), removed)
    }

    private fun applyBulkUpdate(
        state: RepeatCfgSyncState,
        actionPayload: JSONObject?,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        if (actionPayload == null) return state
        val changes = actionPayload.optJSONObject("changes") ?: return state
        val ids = actionPayload.optJSONArray("ids") ?: return state
        var next = state
        for (i in 0 until ids.length()) {
            val id = ids.optString(i, "")
            if (id.isNotEmpty()) next = merge(next, id, changes, emptySet(), removed)
        }
        return next
    }

    private fun applyLww(
        state: RepeatCfgSyncState,
        op: JSONObject,
        payload: JSONObject?,
        actionPayload: JSONObject?,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        if (actionPayload == null) return state
        val id = actionPayload.optString("id", "").ifEmpty { op.optString("entityId", "") }
        if (id.isEmpty()) return state
        val replace = payload?.optString("lwwUpdateMode", "") == "replace"
        if (replace) {
            val cfg = RepeatCfg.fromJson(actionPayload, complete = true) ?: return state
            noteArmable(id, state.byId(id), cfg, explicitOff = false, removed)
            return state.upsert(cfg)
        }
        return merge(state, id, actionPayload, clearedFields(payload), removed)
    }

    private fun deleteInstance(state: RepeatCfgSyncState, actionPayload: JSONObject?): RepeatCfgSyncState {
        if (actionPayload == null) return state
        val id = actionPayload.optString("repeatCfgId", "")
        val day = actionPayload.optString("dateStr", "")
        if (id.isEmpty() || !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(day)) return state
        val before = state.byId(id) ?: RepeatCfg(id = id)
        if (day in before.deletedInstanceDates) return state
        return state.upsert(before.copy(deletedInstanceDates = before.deletedInstanceDates + day))
    }

    private fun merge(
        state: RepeatCfgSyncState,
        id: String,
        changes: JSONObject,
        cleared: Set<String>,
        removed: MutableSet<String>,
    ): RepeatCfgSyncState {
        val before = state.byId(id)
        val base = before ?: RepeatCfg(id = id)
        val after = base.applyChanges(changes, cleared)
        val explicitOff = explicitlyDisarmed(changes, cleared)
        noteArmable(id, before, after, explicitOff, removed)
        return state.upsert(after)
    }

    /**
     * A config that lost its alarm (deleted, paused, reminder cleared) must
     * suppress occurrence alarms already armed for it, including when this
     * phone has not stored the config yet — the delete op names the id.
     */
    private fun noteArmable(
        id: String,
        before: RepeatCfg?,
        after: RepeatCfg,
        explicitOff: Boolean,
        removed: MutableSet<String>,
    ) {
        if (after.isArmable()) {
            removed.remove(id)
        } else if (before?.isArmable() == true || explicitOff) {
            removed.add(id)
        }
    }

    private fun explicitlyDisarmed(changes: JSONObject, cleared: Set<String>): Boolean {
        if ("startTime" in cleared || "remindAt" in cleared) return true
        if (changes.has("isPaused") && !changes.isNull("isPaused") && changes.optBoolean("isPaused", false)) return true
        if (changes.has("waitForCompletion") && !changes.isNull("waitForCompletion") && changes.optBoolean("waitForCompletion", false)) {
            return true
        }
        if (changes.has("remindAt") && (changes.isNull("remindAt") || changes.optString("remindAt", "") == "DoNotRemind")) {
            return true
        }
        if (changes.has("startTime") && (changes.isNull("startTime") || changes.optString("startTime", "").isEmpty())) {
            return true
        }
        return false
    }

    private fun clearedFields(obj: JSONObject?): Set<String> {
        val arr: JSONArray = obj?.optJSONArray("clearedFields") ?: return emptySet()
        return buildSet {
            for (i in 0 until arr.length()) {
                val key = arr.optString(i, "")
                if (key.isNotEmpty() && key.length <= 64) add(key)
            }
        }
    }

    private fun entityIds(op: JSONObject, payload: JSONObject?): List<String> {
        val ids = LinkedHashSet<String>()
        val one = op.optString("entityId", "")
        if (one.isNotEmpty()) ids.add(one)
        op.optJSONArray("entityIds")?.let { arr ->
            for (i in 0 until arr.length()) {
                val id = arr.optString(i, "")
                if (id.isNotEmpty()) ids.add(id)
            }
        }
        payload?.optJSONObject("actionPayload")?.optJSONArray("ids")?.let { arr ->
            for (i in 0 until arr.length()) {
                val id = arr.optString(i, "")
                if (id.isNotEmpty()) ids.add(id)
            }
        }
        return ids.toList()
    }
}
