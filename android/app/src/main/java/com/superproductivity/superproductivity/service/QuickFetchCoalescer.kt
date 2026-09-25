package com.superproductivity.superproductivity.service

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Shares one fetch across callers that ask for the same [K] within [ttlMs].
 *
 * Built for the alarm stale check: due-date notifications default to 09:00:00
 * and reminders cluster on full hours, so a device with N alarms sent N
 * identical GETs as SuperSync's connection pool ran out at hh:00 (measured
 * 2026-09-23 08:00Z: 105 of 144 limit=100 pages repeated one for the same
 * account and cursor, vs 1-2 per minute before). Coalescing turns N alarms
 * into one GET per device.
 *
 * Failures are shared and kept for [ttlMs] too: alarms fail open, and retrying
 * against a server that is already struggling would only feed the burst.
 *
 * shortcut: one entry per process — a map if checks with different keys
 * ever need to interleave within the ttl.
 */
class QuickFetchCoalescer<K, V>(
    private val ttlMs: Long,
    private val nowMs: () -> Long,
) {
    private class Entry<K, V>(
        val key: K,
        val startedAtMs: Long,
        val result: CompletableDeferred<V>,
    )

    private val mutex = Mutex()
    private var entry: Entry<K, V>? = null

    suspend fun get(key: K, fetch: suspend () -> V): V {
        var owned: CompletableDeferred<V>? = null
        val shared = mutex.withLock {
            val current = entry
            if (current != null && current.key == key && nowMs() - current.startedAtMs < ttlMs) {
                current.result
            } else {
                CompletableDeferred<V>().also {
                    owned = it
                    entry = Entry(key, nowMs(), it)
                }
            }
        }
        val result = owned ?: return shared.await()
        try {
            result.complete(fetch())
        } catch (e: Throwable) {
            result.completeExceptionally(e)
        }
        return result.await()
    }
}
