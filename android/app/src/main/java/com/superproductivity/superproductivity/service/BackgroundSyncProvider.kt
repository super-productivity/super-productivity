package com.superproductivity.superproductivity.service

/**
 * Result from a background sync provider's reminder change detection.
 *
 * @param taskIdsToCancel Set of task IDs whose reminders should be cancelled
 * @param latestSeq The latest server sequence number processed
 * @param hasMore Whether more operations are available (pagination)
 */
data class ReminderChangeResult(
    val taskIdsToCancel: Set<String>,
    val latestSeq: Long,
    val hasMore: Boolean
)

/**
 * Interface for background sync providers that can detect reminder-relevant changes.
 *
 * Currently implemented for SuperSync (lightweight operation-based API).
 * Could be extended to Dropbox/WebDAV in the future, though those would require
 * downloading the full sync file which is heavier.
 */
interface BackgroundSyncProvider {
    /**
     * Fetch task IDs that should have their reminders cancelled since lastSeq.
     *
     * @return ReminderChangeResult on success, null on error (caller should retry later)
     */
    suspend fun fetchReminderChanges(
        baseUrl: String,
        accessToken: String,
        lastSeq: Long,
        limit: Int = 100
    ): ReminderChangeResult?
}
