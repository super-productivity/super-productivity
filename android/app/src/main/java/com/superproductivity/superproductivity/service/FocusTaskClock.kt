package com.superproductivity.superproductivity.service

/** Task time mirrored beside a live focus session for WebView recovery. */
internal class FocusTaskClock {
    data class Snapshot(val taskId: String?, val timeSpentMs: Long, val isTracking: Boolean)

    private var taskId: String? = null
    private var timeSpentMs = 0L
    private var anchorMs = 0L
    private var taskWasRunning = false
    private var focusPaused = false

    @Synchronized
    fun update(taskId: String?, timeSpentMs: Long, nowMs: Long, isTracking: Boolean = true) {
        if (taskId == null) {
            // No active task: keep the last id and its live total for recovery.
            this.timeSpentMs = snapshot(nowMs).timeSpentMs
            taskWasRunning = false
        } else {
            this.taskId = taskId
            this.timeSpentMs = timeSpentMs.coerceAtLeast(0)
            taskWasRunning = isTracking
        }
        anchorMs = nowMs
    }

    @Synchronized
    fun adjust(taskId: String, deltaMs: Long) {
        if (this.taskId != taskId) return
        timeSpentMs = (timeSpentMs + deltaMs).coerceAtLeast(0)
    }

    @Synchronized
    fun setFocusPaused(paused: Boolean, nowMs: Long) {
        if (paused == focusPaused) return
        timeSpentMs = snapshot(nowMs).timeSpentMs
        anchorMs = nowMs
        focusPaused = paused
    }

    @Synchronized
    fun snapshot(nowMs: Long): Snapshot {
        val tracking = taskId != null && taskWasRunning && !focusPaused
        return Snapshot(
            taskId,
            timeSpentMs + if (tracking) (nowMs - anchorMs).coerceAtLeast(0) else 0,
            tracking
        )
    }

    @Synchronized
    fun clear() {
        taskId = null
        timeSpentMs = 0
        anchorMs = 0
        taskWasRunning = false
        focusPaused = false
    }
}
