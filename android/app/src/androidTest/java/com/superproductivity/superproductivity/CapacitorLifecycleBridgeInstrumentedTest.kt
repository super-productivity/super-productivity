package com.superproductivity.superproductivity

import android.os.SystemClock
import android.webkit.WebView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.capacitorjs.plugins.app.AppPlugin
import com.superproductivity.plugins.webdavhttp.WebDavHttpPlugin
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Native smoke for the Capacitor shell.
 *
 * Serves controlled HTML through Capacitor's real local server so the production
 * JavaScript injection, plugin bridge, activity lifecycle and WebDavHttp
 * transport all participate. Stops at the native boundary; configured-provider
 * background sync is covered separately by #9152.
 *
 * Runs on the DEBUG variant, so it says nothing about minification. R8 is
 * covered instead by android/run-android-checks.sh, which launches the minified
 * r8Test APK — see that script for why instrumentation cannot do that job.
 *
 * Run: ./gradlew :app:connectedPlayDebugAndroidTest (emulator/device required).
 */
@RunWith(AndroidJUnit4::class)
class CapacitorLifecycleBridgeInstrumentedTest {

    @Test
    fun capacitorPluginBridgeSurvivesBackgroundResume() {
        val responseGate = CountDownLatch(1)
        val requestStarted = CountDownLatch(1)
        val recordedRequest = AtomicReference<RecordedRequest>()
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                recordedRequest.set(request)
                requestStarted.countDown()
                return if (responseGate.await(20, TimeUnit.SECONDS)) {
                    MockResponse()
                        .setResponseCode(201)
                        .setBody("stored-after-resume")
                } else {
                    MockResponse().setResponseCode(504)
                }
            }
        }
        server.start()

        val scenario = ActivityScenario.launch(CapacitorMainActivity::class.java)
        lateinit var webView: WebView
        var webRoot: File? = null

        try {
            scenario.onActivity { activity ->
                val bridge = activity.bridge
                assertNotNull("Capacitor bridge should be created", bridge)
                assertNotNull("Capacitor WebView should be created", bridge.webView)
                assertEquals(AppPlugin::class.java, bridge.getPlugin("App").pluginClass)
                assertEquals(
                    WebDavHttpPlugin::class.java,
                    bridge.getPlugin("WebDavHttp").pluginClass,
                )

                webView = bridge.webView
                val testWebRoot = File(activity.cacheDir, "capacitor-lifecycle-bridge-smoke")
                check(testWebRoot.mkdirs() || testWebRoot.isDirectory)
                File(testWebRoot, "index.html").writeText(TEST_PAGE)
                webRoot = testWebRoot
                bridge.setServerBasePath(testWebRoot.absolutePath)
            }

            awaitJavaScript(webView, "window.__capacitorSmoke?.ready === true")
            val readyState = readSmokeState(webView)
            assertEquals("android", readyState.getString("platform"))
            assertTrue(readyState.getBoolean("hasAndroidBridge"))
            assertTrue(readyState.getBoolean("hasSupAndroid"))
            assertTrue(readyState.getBoolean("hasAppPlugin"))
            assertTrue(readyState.getBoolean("hasLocalNotificationsPlugin"))
            assertTrue(readyState.getBoolean("hasWebDavPlugin"))
            assertTrue(
                "Capacitor plugin initialization should not reject: ${readyState.optString("readyError")}",
                !readyState.has("readyError"),
            )

            evaluateJavaScript(
                webView,
                "window.startWebDavPut(${JSONObject.quote(server.url("/native-smoke.txt").toString())})",
            )
            assertTrue(
                "WebDavHttp should start the PUT before backgrounding",
                requestStarted.await(10, TimeUnit.SECONDS),
            )
            assertEquals("pending", readSmokeState(webView).getString("putState"))

            scenario.moveToState(Lifecycle.State.CREATED)
            assertEquals(Lifecycle.State.CREATED, scenario.state)
            assertEquals(
                "The server response must still be held while the activity is backgrounded",
                1L,
                responseGate.count,
            )

            scenario.moveToState(Lifecycle.State.RESUMED)
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
            awaitJavaScript(
                webView,
                """
                    window.__capacitorSmoke?.supPause >= 1 &&
                    window.__capacitorSmoke?.supResume >= 1 &&
                    window.__capacitorSmoke?.appStates.includes(false) &&
                    window.__capacitorSmoke?.appStates.includes(true)
                """.trimIndent(),
            )

            val resumedState = readSmokeState(webView)
            assertEquals("pending", resumedState.getString("putState"))
            assertTrue(resumedState.getInt("supPause") >= 1)
            assertTrue(resumedState.getInt("supResume") >= 1)
            assertInactiveThenActive(resumedState.getJSONArray("appStates"))

            responseGate.countDown()
            awaitJavaScript(webView, "window.__capacitorSmoke?.putState === 'resolved'")

            val completedState = readSmokeState(webView)
            assertEquals(201, completedState.getInt("putStatus"))
            assertEquals("stored-after-resume", completedState.getString("putData"))

            val request = recordedRequest.get()
            assertNotNull("Mock server should record the WebDavHttp request", request)
            assertEquals("PUT", request.method)
            assertEquals("/native-smoke.txt", request.path)
            assertEquals("Basic native-smoke-token", request.getHeader("Authorization"))
            assertEquals("lifecycle-body", request.body.readUtf8())
        } finally {
            responseGate.countDown()
            scenario.close()
            server.shutdown()
            webRoot?.deleteRecursively()
        }
    }

    private fun awaitJavaScript(
        webView: WebView,
        predicate: String,
        timeoutSeconds: Long = 10,
    ) {
        val deadline = SystemClock.elapsedRealtime() + TimeUnit.SECONDS.toMillis(timeoutSeconds)
        var lastResult = "not evaluated"
        while (SystemClock.elapsedRealtime() < deadline) {
            lastResult = evaluateJavaScript(webView, "Boolean($predicate)")
            if (lastResult == "true") {
                return
            }
            SystemClock.sleep(50)
        }
        fail("Timed out waiting for JavaScript predicate `$predicate`; last result: $lastResult")
    }

    private fun evaluateJavaScript(webView: WebView, script: String): String {
        val completed = CountDownLatch(1)
        val result = AtomicReference<String>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            webView.evaluateJavascript(script) {
                result.set(it)
                completed.countDown()
            }
        }
        assertTrue(
            "JavaScript evaluation should complete",
            completed.await(10, TimeUnit.SECONDS),
        )
        return requireNotNull(result.get())
    }

    private fun readSmokeState(webView: WebView): JSONObject {
        val encoded = evaluateJavaScript(
            webView,
            "JSON.stringify(window.__capacitorSmoke)",
        )
        val json = JSONTokener(encoded).nextValue() as String
        return JSONObject(json)
    }

    private fun assertInactiveThenActive(appStates: JSONArray) {
        val values = (0 until appStates.length()).map(appStates::getBoolean)
        val inactiveIndex = values.indexOf(false)
        assertTrue("Capacitor App should report the background state", inactiveIndex >= 0)
        assertTrue(
            "Capacitor App should report active after the background state",
            values.drop(inactiveIndex + 1).contains(true),
        )
    }

    private companion object {
        val TEST_PAGE = """
            <!doctype html>
            <html>
              <head><meta charset="utf-8"></head>
              <body>
                <script>
                  const smoke = window.__capacitorSmoke = {
                    ready: false,
                    platform: window.Capacitor?.getPlatform?.(),
                    hasAndroidBridge: typeof window.androidBridge !== 'undefined',
                    hasSupAndroid:
                      typeof window.SUPAndroid !== 'undefined' &&
                      typeof window.SUPAndroid.getVersion === 'function',
                    hasAppPlugin:
                      typeof window.Capacitor?.Plugins?.App?.addListener === 'function',
                    hasLocalNotificationsPlugin:
                      typeof window.Capacitor?.Plugins?.LocalNotifications?.checkPermissions ===
                      'function',
                    hasWebDavPlugin:
                      typeof window.Capacitor?.Plugins?.WebDavHttp?.request === 'function',
                    supPause: 0,
                    supResume: 0,
                    appStates: [],
                    putState: 'not-started',
                  };

                  window.SUPAndroid['onPause$'] = {
                    next: () => smoke.supPause++,
                  };
                  window.SUPAndroid['onResume$'] = {
                    next: () => smoke.supResume++,
                  };
                  window.Capacitor.Plugins.App.addListener(
                    'appStateChange',
                    ({ isActive }) => smoke.appStates.push(isActive),
                  );

                  window.startWebDavPut = (url) => {
                    smoke.putState = 'pending';
                    window.Capacitor.Plugins.WebDavHttp.request({
                      url,
                      method: 'PUT',
                      headers: {
                        Authorization: 'Basic native-smoke-token',
                        'Content-Type': 'text/plain; charset=utf-8',
                      },
                      data: 'lifecycle-body',
                    }).then((response) => {
                      smoke.putStatus = response.status;
                      smoke.putData = response.data;
                      smoke.putState = 'resolved';
                    }).catch((error) => {
                      smoke.putError = String(error?.message || error);
                      smoke.putState = 'rejected';
                    });
                  };

                  window.Capacitor.Plugins.App.getState()
                    .then(() => smoke.ready = true)
                    .catch((error) => {
                      // Still ready: a rejection has to reach the assertions as
                      // readyError, not as an opaque predicate timeout.
                      smoke.readyError = String(error?.message || error);
                      smoke.ready = true;
                    });
                </script>
              </body>
            </html>
        """.trimIndent()
    }
}
