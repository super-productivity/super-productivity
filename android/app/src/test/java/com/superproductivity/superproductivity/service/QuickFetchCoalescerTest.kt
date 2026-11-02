package com.superproductivity.superproductivity.service

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Alarms that fire in the same second (due-date notifications default to
 * 09:00:00) each ran their own stale-check GET, which reached the sync server
 * as a synchronized burst. These tests pin the coalescing that replaces it.
 */
class QuickFetchCoalescerTest {

    private var now = 0L

    private fun coalescer() = QuickFetchCoalescer<String, String>(ttlMs = 60_000, nowMs = { now })

    @Test
    fun `alarms firing together share one fetch`() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val subject = coalescer()
        var fetches = 0

        val first = async { subject.get("k") { gate.await(); fetches++; "result" } }
        yield()
        val second = async { subject.get("k") { fetches++; "other" } }
        yield()
        gate.complete(Unit)

        assertEquals("result", first.await())
        assertEquals("result", second.await())
        assertEquals(1, fetches)
    }

    @Test
    fun `an alarm within the ttl reuses the finished fetch`() = runBlocking {
        val subject = coalescer()
        var fetches = 0
        subject.get("k") { fetches++; "result" }

        now = 59_999
        assertEquals("result", subject.get("k") { fetches++; "fresh" })
        assertEquals(1, fetches)
    }

    @Test
    fun `an alarm after the ttl fetches again`() = runBlocking {
        val subject = coalescer()
        subject.get("k") { "old" }

        now = 60_000
        assertEquals("fresh", subject.get("k") { "fresh" })
    }

    @Test
    fun `a different key fetches again`() = runBlocking {
        val subject = coalescer()
        subject.get("seq-1") { "old" }

        assertEquals("fresh", subject.get("seq-2") { "fresh" })
    }

    @Test
    fun `a failed fetch fails every waiting alarm`() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val subject = coalescer()
        val boom = IllegalStateException("boom")

        val first = async { runCatching { subject.get("k") { gate.await(); throw boom } } }
        yield()
        val second = async { runCatching { subject.get("k") { "unused" } } }
        yield()
        gate.complete(Unit)

        // Messages, not identity: coroutine stack-trace recovery may copy the exception.
        assertEquals(boom.message, first.await().exceptionOrNull()?.message)
        assertEquals(boom.message, second.await().exceptionOrNull()?.message)
    }
}
