package com.superproductivity.superproductivity.share

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class ShareUploaderTest {
    @Test
    fun retriesOnlyTransientFailures() {
        for (status in listOf(200, 201)) {
            assertEquals(ShareUploader.Outcome.DONE, ShareUploader.outcomeFor(status))
        }
        for (status in listOf(408, 429, 500, 502, 503)) {
            assertEquals(ShareUploader.Outcome.RETRY, ShareUploader.outcomeFor(status))
        }
        // Answers, not failures: capture off, other key, full, logged out, no capture.
        for (status in listOf(400, 401, 403, 404, 409, 413)) {
            assertEquals(ShareUploader.Outcome.RELEASED, ShareUploader.outcomeFor(status))
        }
    }

    @Test
    fun sealsOnlyThePayloadFields() {
        val entry = JSONObject(
            """{"v":1,"id":"x","source":"share","upload":"pending","sendingAt":5,
              "title":"T","notes":"N","link":"https://e.com","createdAt":3,"client":"Android share"}""",
        )
        val payload = ShareUploader.payloadOf(entry)
        assertEquals(
            setOf("v", "title", "notes", "link", "createdAt", "client"),
            payload.keys().asSequence().toSet(),
        )
        assertEquals("T", payload.getString("title"))
    }
}
