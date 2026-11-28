package com.superproductivity.superproductivity.receiver

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Play vitals showed ACTION_SHOW_REMINDER ANRs with the stale-check thread
 * stuck in InetAddress.getAllByName: system DNS ignores OkHttp's callTimeout,
 * so the goAsync() result was never finished in time. The wait must end on
 * budget even when the work itself cannot be cancelled.
 */
class AwaitWithinTest {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Test
    fun `blocking work that ignores cancellation is cut off at the budget`() = runBlocking {
        val startedAt = System.nanoTime()

        val result = awaitWithin(200L, scope) { Thread.sleep(3_000L); true }

        val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
        assertNull(result)
        assertTrue("waited ${elapsedMs}ms", elapsedMs < 1_500L)
    }

    @Test
    fun `work that finishes in time returns its result`() = runBlocking {
        assertEquals(true, awaitWithin(2_000L, scope) { true })
    }

    @Test(expected = IllegalStateException::class)
    fun `failures reach the caller so the alarm can fail open`(): Unit = runBlocking {
        awaitWithin(2_000L, scope) { throw IllegalStateException("boom") }
    }
}
