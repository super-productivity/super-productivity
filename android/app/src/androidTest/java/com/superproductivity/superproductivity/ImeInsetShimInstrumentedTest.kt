package com.superproductivity.superproductivity

import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnit4
import com.superproductivity.superproductivity.webview.ImeWebViewHeight
import com.superproductivity.superproductivity.webview.NativeInsetShimGate
import com.superproductivity.superproductivity.webview.WebViewCompatibilityChecker
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opens the soft keyboard over the real Capacitor shell and checks who moved the
 * WebView out from under it — the answer #9316 could not get from a reporter.
 *
 * Two inset owners exist (docs/android-edge-to-edge-keyboard.md): Capacitor's
 * `SystemBars` on WebView >= 140 or API >= 35, and our native shim
 * (`CapacitorMainActivity.adjustWebViewHeightForKeyboard`, gated by
 * [NativeInsetShimGate]) on the remaining API < 35 / WebView < 140 band. The
 * shim is a strict no-op wherever SystemBars acts, so "the bar looks fixed" on a
 * device cannot tell a working shim from one that never ran. This test can: it
 * computes the gate's inputs the way the activity does, then asserts the
 * **mechanism** the gate selects (an explicit WebView height pinned to the
 * keyboard top, or untouched layout params) and, on every API level, the
 * **symptom** (the WebView ends at the keyboard top and the web layout viewport
 * shrank — which is what lifts the `position: fixed` add-task bar).
 *
 * CI runs it twice (android/run-android-checks.sh on API 35, where SystemBars
 * owns the inset, and android/run-android-ime-check.sh on an API 34 image whose
 * bundled WebView is below 140, where the shim must). Emulators report a
 * hardware keyboard, so both scripts set `show_ime_with_hard_keyboard` first —
 * without it the IME never opens and the test fails on the first wait.
 *
 * Geometry and versions only are logged, never user content.
 */
@RunWith(AndroidJUnit4::class)
class ImeInsetShimInstrumentedTest {

    /** One reading of everything the activity's keyboard listener decides from. */
    private data class Geometry(
        /** `rootView.rootView.height` — the listener's `screenHeight`. */
        val rootHeight: Int,
        /** `getWindowVisibleDisplayFrame().bottom` — the keyboard top while it is up. */
        val rectBottom: Int,
        val webViewTop: Int,
        val webViewBottom: Int,
        /** `webView.layoutParams.height`: MATCH_PARENT at rest, explicit px under the shim. */
        val paramsHeight: Int,
        /** Root window insets' IME visibility — diagnostic only, not asserted. */
        val imeVisible: Boolean,
    ) {
        /** Same criterion as `CapacitorMainActivity`'s `OnGlobalLayoutListener`. */
        val keyboardOpenPerListener: Boolean
            get() = rootHeight - rectBottom > rootHeight * 0.15
    }

    @Test
    fun webContentEndsAboveTheKeyboardWhicheverOwnerInsetsIt() {
        val scenario = ActivityScenario.launch(CapacitorMainActivity::class.java)
        lateinit var activity: CapacitorMainActivity
        lateinit var webView: WebView
        var webRoot: File? = null

        try {
            scenario.onActivity { a ->
                activity = a
                webView = a.bridge.webView
                val root = File(a.cacheDir, "ime-inset-shim-test")
                check(root.mkdirs() || root.isDirectory)
                File(root, "index.html").writeText(TEST_PAGE)
                webRoot = root
                a.bridge.setServerBasePath(root.absolutePath)
            }
            awaitJavaScript(
                webView,
                "document.readyState === 'complete' && !!document.getElementById('field')",
            )

            // Gate inputs, derived exactly as the activity derives them, so the
            // expectation below is the gate's own decision rather than a guess
            // about the emulator image.
            val compat = onMainSync { WebViewCompatibilityChecker.evaluate(activity) }
            val activeMajor = NativeInsetShimGate.activeProviderMajor(compat)
            val expectShim = NativeInsetShimGate.shouldRunShim(Build.VERSION.SDK_INT, activeMajor)
            // Framework API (26+), same source SystemBars reads; androidx.webkit is
            // not on the app's compile classpath.
            val current =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WebView.getCurrentWebViewPackage() else null
            Log.i(
                TAG,
                "sdk=${Build.VERSION.SDK_INT} activeMajor=$activeMajor " +
                    "(raw=${compat.majorVersion} src=${compat.source} " +
                    "current=${compat.providerPackageIsCurrent}) " +
                    "currentWebViewPackage=${current?.packageName}/${current?.versionName} " +
                    "expectShim=$expectShim"
            )
            // CI pins which owner an emulator image is meant to exercise. If the
            // image is refreshed with a WebView across the 140 boundary the gate
            // flips branch and every assertion below would still pass — silently
            // dropping coverage of the #9316 band. Fail loudly instead.
            InstrumentationRegistry.getArguments().getString(EXPECT_SHIM_ARG)?.let { pinned ->
                assertEquals(
                    "$EXPECT_SHIM_ARG=$pinned was pinned for this emulator image but the gate " +
                        "decided otherwise (sdk=${Build.VERSION.SDK_INT} activeMajor=$activeMajor " +
                        "current=${current?.versionName}): the image's WebView crossed the 140 " +
                        "boundary or the version source broke, so this run no longer covers " +
                        "the band it was added for",
                    pinned.toBoolean(),
                    expectShim,
                )
            }

            val resting = awaitGeometry(activity, webView, "the keyboard to be closed before the test starts") {
                !it.keyboardOpenPerListener
            }
            val innerHeightBefore = readInnerHeight(webView)
            Log.i(TAG, "resting: $resting innerHeight=$innerHeightBefore")

            showIme(activity, webView)
            val open = awaitImeOpen(activity, webView)
            Log.i(TAG, "open: $open")

            // Mechanism: the owner the gate selected must be the one that acted.
            if (expectShim) {
                val pinned = awaitGeometry(
                    activity,
                    webView,
                    "the native shim to pin the WebView height to the keyboard top",
                ) {
                    it.keyboardOpenPerListener &&
                        it.paramsHeight == ImeWebViewHeight.targetHeight(it.rectBottom, it.webViewTop)
                }
                assertNotEquals(
                    "the shim must write an explicit height, not leave the resting value: $pinned",
                    resting.paramsHeight,
                    pinned.paramsHeight,
                )
            } else {
                assertEquals(
                    "the shim must not touch the layout params where SystemBars owns the IME inset: $open",
                    resting.paramsHeight,
                    open.paramsHeight,
                )
            }

            // Symptom, independent of owner: the WebView ends AT the keyboard top —
            // two-sided, because a WebView ending well above it is the #8508
            // double-inset squash — and the web layout viewport shrank with it.
            val above = awaitGeometry(
                activity,
                webView,
                "the WebView bottom to sit at the keyboard top (within ${TOLERANCE_PX}px)",
            ) {
                it.keyboardOpenPerListener && abs(it.webViewBottom - it.rectBottom) <= TOLERANCE_PX
            }
            awaitJavaScript(webView, "window.innerHeight < $innerHeightBefore")
            Log.i(TAG, "settled: $above innerHeight=${readInnerHeight(webView)}")

            // No feedback loop: a later pass must read the same height.
            SystemClock.sleep(SETTLE_MS)
            val later = measure(activity, webView)
            assertEquals(
                "WebView height must be stable across layout passes: $above vs $later",
                above.paramsHeight,
                later.paramsHeight,
            )
            assertEquals(
                "WebView bottom must be stable across layout passes: $above vs $later",
                above.webViewBottom,
                later.webViewBottom,
            )
            if (!expectShim) {
                assertEquals(
                    "the shim must stay off across layout passes where SystemBars owns the inset: $later",
                    resting.paramsHeight,
                    later.paramsHeight,
                )
            }

            hideIme(activity, webView)
            awaitGeometry(activity, webView, "the keyboard to close") { !it.keyboardOpenPerListener }
            awaitGeometry(activity, webView, "the resting WebView height to be restored") {
                it.paramsHeight == resting.paramsHeight
            }
            awaitJavaScript(webView, "Math.abs(window.innerHeight - $innerHeightBefore) <= 1")
        } finally {
            scenario.close()
            webRoot?.deleteRecursively()
        }
    }

    private fun showIme(activity: CapacitorMainActivity, webView: WebView) {
        // View focus first, then the editable inside it, then the request: a
        // programmatic focus() without a user gesture does not raise the IME by
        // itself, and show(ime()) needs an editor attached to the focused view.
        onMainSync { webView.requestFocus() }
        evaluateJavaScript(webView, "document.getElementById('field').focus(); 'focused'")
        onMainSync {
            WindowInsetsControllerCompat(activity.window, webView)
                .show(WindowInsetsCompat.Type.ime())
        }
    }

    private fun hideIme(activity: CapacitorMainActivity, webView: WebView) {
        evaluateJavaScript(webView, "document.getElementById('field').blur(); 'blurred'")
        onMainSync {
            WindowInsetsControllerCompat(activity.window, webView)
                .hide(WindowInsetsCompat.Type.ime())
        }
    }

    /**
     * Waits for the keyboard as the activity's listener sees it. One fallback via
     * InputMethodManager if the insets-controller request did nothing, then a hard
     * failure carrying the last geometry — never a silent pass.
     */
    private fun awaitImeOpen(activity: CapacitorMainActivity, webView: WebView): Geometry {
        val first = pollGeometry(activity, webView, SHOW_IME_FIRST_TRY_SECONDS) {
            it.keyboardOpenPerListener
        }
        if (first != null) return first
        Log.i(TAG, "IME not open after show(ime()); retrying via InputMethodManager")
        onMainSync {
            activity.getSystemService(InputMethodManager::class.java)
                .showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT)
        }
        return awaitGeometry(
            activity,
            webView,
            "the IME to open (visible frame must drop by more than 15% of the root height; " +
                "on an emulator make sure `settings put secure show_ime_with_hard_keyboard 1` ran)",
        ) { it.keyboardOpenPerListener }
    }

    private fun measure(activity: CapacitorMainActivity, webView: WebView): Geometry =
        onMainSync {
            val content = activity.findViewById<View>(android.R.id.content)
            val rect = Rect()
            content.getWindowVisibleDisplayFrame(rect)
            val location = IntArray(2)
            webView.getLocationOnScreen(location)
            Geometry(
                rootHeight = content.rootView.height,
                rectBottom = rect.bottom,
                webViewTop = location[1],
                webViewBottom = location[1] + webView.height,
                paramsHeight = webView.layoutParams.height,
                imeVisible = ViewCompat.getRootWindowInsets(content)
                    ?.isVisible(WindowInsetsCompat.Type.ime()) == true,
            )
        }

    private fun pollGeometry(
        activity: CapacitorMainActivity,
        webView: WebView,
        timeoutSeconds: Long,
        predicate: (Geometry) -> Boolean,
    ): Geometry? {
        val deadline = SystemClock.elapsedRealtime() + TimeUnit.SECONDS.toMillis(timeoutSeconds)
        var last: Geometry
        do {
            last = measure(activity, webView)
            if (predicate(last)) return last
            SystemClock.sleep(POLL_MS)
        } while (SystemClock.elapsedRealtime() < deadline)
        lastGeometry = last
        return null
    }

    private fun awaitGeometry(
        activity: CapacitorMainActivity,
        webView: WebView,
        waitingFor: String,
        timeoutSeconds: Long = DEFAULT_TIMEOUT_SECONDS,
        predicate: (Geometry) -> Boolean,
    ): Geometry =
        pollGeometry(activity, webView, timeoutSeconds, predicate)
            ?: run {
                fail("Timed out waiting for $waitingFor; last geometry: $lastGeometry")
                error("unreachable")
            }

    private var lastGeometry: Geometry? = null

    private fun readInnerHeight(webView: WebView): Int =
        evaluateJavaScript(webView, "window.innerHeight").toDouble().toInt()

    private fun <T> onMainSync(block: () -> T): T {
        val result = AtomicReference<T>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { result.set(block()) }
        return result.get()
    }

    private fun awaitJavaScript(
        webView: WebView,
        predicate: String,
        timeoutSeconds: Long = DEFAULT_TIMEOUT_SECONDS,
    ) {
        val deadline = SystemClock.elapsedRealtime() + TimeUnit.SECONDS.toMillis(timeoutSeconds)
        var lastResult = "not evaluated"
        while (SystemClock.elapsedRealtime() < deadline) {
            lastResult = evaluateJavaScript(webView, "Boolean($predicate)")
            if (lastResult == "true") {
                return
            }
            SystemClock.sleep(POLL_MS)
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
            completed.await(DEFAULT_TIMEOUT_SECONDS, TimeUnit.SECONDS),
        )
        return requireNotNull(result.get())
    }

    private companion object {
        const val TAG = "SUPKeyboardTest"
        /** Instrumentation argument set by android/run-android-ime-check.sh. */
        const val EXPECT_SHIM_ARG = "expectShim"
        const val DEFAULT_TIMEOUT_SECONDS = 10L
        const val SHOW_IME_FIRST_TRY_SECONDS = 5L
        const val POLL_MS = 50L
        const val SETTLE_MS = 300L
        // Sub-pixel rounding between the visible frame and the view bottom.
        const val TOLERANCE_PX = 2

        // The viewport meta mirrors src/index.html: SystemBars reads
        // viewport-fit=cover back from this tag at onDOMReady and only takes its
        // WebView >= 140 passthrough branch when it is present. On API >= 35 it
        // pads in both branches, so today this only matters if an image in the
        // API < 35 / WebView >= 140 band is ever added — keep the page matching
        // production regardless.
        val TEST_PAGE = """
            <!doctype html>
            <html>
              <head>
                <meta charset="utf-8" />
                <meta
                  name="viewport"
                  content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
                />
              </head>
              <body style="margin: 0">
                <input
                  id="field"
                  type="text"
                  style="position: fixed; bottom: 8px; left: 8px; right: 8px"
                />
              </body>
            </html>
        """.trimIndent()
    }
}
