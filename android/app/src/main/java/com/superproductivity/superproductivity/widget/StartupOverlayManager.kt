package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.util.Log
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.animation.AccelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView

import com.getcapacitor.BridgeActivity
import com.superproductivity.superproductivity.R

/**
 * Manages a native overlay shown on top of the webview during app startup.
 * Shows a FAB initially; tapping it reveals an input bar for quick task entry.
 * Tasks are stored in WidgetTaskQueue (SharedPreferences) for processing after hydration.
 */
class StartupOverlayManager(private val activity: android.app.Activity) {
    private var overlayView: View? = null
    private var fab: ImageButton? = null
    private var editText: EditText? = null
    private var feedbackText: TextView? = null
    private var barView: LinearLayout? = null
    private var layoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var insetLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var taskCount = 0
    private var isBarVisible = false
    // How far the WebView's bottom sits above the overlay's bottom (px) = the
    // bottom inset the edge-to-edge plugin applied to the WebView. This is what
    // the web UI's safe area actually is on this device — measured directly from
    // the WebView's geometry rather than guessed from navigationBars(), which
    // does not match the applied inset on gesture-nav devices. -1 = not measured.
    private var webViewBottomInset = -1

    private val isDarkMode: Boolean
        get() {
            val nightMode = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
            return nightMode == Configuration.UI_MODE_NIGHT_YES
        }

    fun show() {
        val rootView = activity.findViewById<ViewGroup>(android.R.id.content)
        overlayView = LayoutInflater.from(activity).inflate(R.layout.startup_overlay, rootView, false)
        rootView.addView(overlayView)

        fab = overlayView?.findViewById(R.id.startup_fab)
        editText = overlayView?.findViewById(R.id.startup_task_input)
        feedbackText = overlayView?.findViewById(R.id.startup_task_feedback)
        barView = overlayView?.findViewById(R.id.startup_overlay_bar)

        applyTheme()

        // Edge-to-edge (Capacitor 8, targetSdk 36): this overlay lives on the
        // full-window android.R.id.content, behind the system navigation bar,
        // while the web UI lives in a WebView that the edge-to-edge plugin insets
        // above the nav bar. Lift the FAB/input bar by that same inset so they
        // line up with the web add-task button/bar we hand off to. Re-measured on
        // each layout so it catches the inset being applied late and on rotation.
        insetLayoutListener = ViewTreeObserver.OnGlobalLayoutListener { updateOverlayInsets() }
        rootView.viewTreeObserver.addOnGlobalLayoutListener(insetLayoutListener)
        updateOverlayInsets()

        editText?.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_DONE ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            ) {
                submitTask()
                true
            } else {
                false
            }
        }

        editText?.isFocusableInTouchMode = true

        // FAB tap → expand to input bar
        fab?.setOnClickListener { expandToInputBar() }

        // Show FAB immediately
        fab?.alpha = 1f

        Log.d(TAG, "Startup overlay shown (darkMode=$isDarkMode)")
    }

    /**
     * Measure how far the WebView's bottom sits above the overlay's bottom (the
     * inset the edge-to-edge plugin applied) and lift the FAB / input bar by it
     * so they align with the web add-task button/bar. Mirroring the WebView's
     * real geometry is device-independent: it works regardless of gesture vs
     * 3-button navigation, where navigationBars() would not match the applied
     * inset. No-op until the views are laid out and when the inset is unchanged.
     */
    private fun updateOverlayInsets() {
        val overlay = overlayView ?: return
        // Freeze the inset once the bar is expanded. The edge-to-edge plugin sets
        // the WebView's bottom margin to 0 while the IME is visible (EdgeToEdge.java:
        // "system already resizes the window for the keyboard"), so re-measuring
        // during the keyboard phase would read ~0 and drop the bar behind the
        // keyboard. The FAB-phase value (keyboard down) is the one the keyboard
        // listener needs. This also stops dead work once the FAB is gone.
        if (isBarVisible) return
        val webView = (activity as? BridgeActivity)?.bridge?.webView ?: return
        if (overlay.height == 0 || webView.height == 0) return

        val overlayLoc = IntArray(2)
        val webViewLoc = IntArray(2)
        overlay.getLocationInWindow(overlayLoc)
        webView.getLocationInWindow(webViewLoc)
        val inset = ((overlayLoc[1] + overlay.height) - (webViewLoc[1] + webView.height))
            .coerceAtLeast(0)
        if (inset == webViewBottomInset) return
        webViewBottomInset = inset

        // Bar is still hidden here (we return early once it is shown), so set its
        // resting margin too; the keyboard listener takes over once expanded.
        val density = activity.resources.displayMetrics.density
        (fab?.layoutParams as? ViewGroup.MarginLayoutParams)?.let { lp ->
            lp.bottomMargin = (FAB_GAP_DP * density).toInt() + webViewBottomInset
            fab?.layoutParams = lp
        }
        (barView?.layoutParams as? ViewGroup.MarginLayoutParams)?.let { lp ->
            lp.bottomMargin = (BAR_GAP_DP * density).toInt() + webViewBottomInset
            barView?.layoutParams = lp
        }
    }

    private fun expandToInputBar() {
        if (isBarVisible) return
        isBarVisible = true

        val rootView = activity.findViewById<ViewGroup>(android.R.id.content)

        // Setup keyboard tracking before showing bar
        val density = activity.resources.displayMetrics.density
        val baseMargin = (BAR_GAP_DP * density).toInt()
        var baseOffset = -1
        layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
            val rect = Rect()
            rootView.getWindowVisibleDisplayFrame(rect)
            val screenHeight = rootView.rootView.height
            val bottomGap = screenHeight - rect.bottom
            if (baseOffset < 0) {
                baseOffset = bottomGap
            }
            val keyboardHeight = bottomGap - baseOffset
            val params = barView?.layoutParams as? ViewGroup.MarginLayoutParams ?: return@OnGlobalLayoutListener
            // baseOffset already captured (and now subtracts) the nav bar, so
            // add the WebView's bottom inset back to keep the bar above it.
            params.bottomMargin =
                (if (keyboardHeight > 0) keyboardHeight + baseMargin else baseMargin) +
                webViewBottomInset.coerceAtLeast(0)
            barView?.layoutParams = params
        }
        rootView.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)

        // Hide FAB
        fab?.visibility = View.GONE

        // Show input bar with slide-up
        barView?.visibility = View.VISIBLE
        barView?.translationY = 100f
        barView?.alpha = 0f
        barView?.animate()
            ?.translationY(0f)
            ?.alpha(1f)
            ?.setDuration(150)
            ?.setInterpolator(DecelerateInterpolator())
            ?.start()

        // Focus input and show keyboard
        editText?.requestFocus()
        editText?.postDelayed({
            val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
        }, 200)

        Log.d(TAG, "Expanded to input bar")
    }

    private fun applyTheme() {
        val density = activity.resources.displayMetrics.density
        val cornerPx = 4 * density // match web --card-border-radius: 4px

        // Style the FAB — match loading animation color (#6495ed)
        val fabColor = Color.parseColor("#6495ED")
        val fabBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(fabColor)
        }
        fab?.background = fabBg

        // Match web AddTaskBar: left/right 4px, bottom gap + 36px action bar
        // height. updateOverlayInsets() re-applies this with the WebView inset.
        val sideMarginPx = (4 * density).toInt()
        val bottomMarginPx = (BAR_GAP_DP * density).toInt()
        val params = barView?.layoutParams as? ViewGroup.MarginLayoutParams
        params?.leftMargin = sideMarginPx
        params?.rightMargin = sideMarginPx
        params?.bottomMargin = bottomMarginPx
        barView?.layoutParams = params

        // Match web: elevation shadow instead of colored border
        barView?.elevation = 12 * density
        barView?.clipToOutline = true

        if (isDarkMode) {
            val barBg = GradientDrawable().apply {
                setColor(Color.parseColor("#333333"))
                cornerRadius = cornerPx
            }
            barView?.background = barBg
            editText?.setTextColor(Color.WHITE)
            editText?.setHintTextColor(Color.argb(128, 255, 255, 255))
            feedbackText?.setTextColor(Color.argb(128, 255, 255, 255))
        } else {
            val barBg = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadius = cornerPx
            }
            barView?.background = barBg
            editText?.setTextColor(Color.parseColor("#212121"))
            editText?.setHintTextColor(Color.argb(128, 33, 33, 33))
            feedbackText?.setTextColor(Color.argb(128, 33, 33, 33))
        }
    }

    private fun submitTask() {
        val title = editText?.text?.toString()?.trim() ?: return
        if (title.isEmpty()) return

        WidgetTaskQueue.addTask(activity, title)
        taskCount++

        editText?.text?.clear()
        updateFeedback()

        Log.d(TAG, "Task queued from startup overlay: $title (total: $taskCount)")
    }

    private fun updateFeedback() {
        feedbackText?.text = activity.resources.getQuantityString(
            R.plurals.startup_tasks_queued, taskCount, taskCount
        )
        feedbackText?.visibility = View.VISIBLE
    }

    /**
     * Phase 1: Returns partial text but keeps the native overlay visible.
     * Returns null if the bar was never opened, empty string if opened but empty.
     */
    fun getPartialTextAndPrepare(): String? {
        if (!isBarVisible) return null
        val partialText = editText?.text?.toString()?.trim() ?: ""
        Log.d(TAG, "getPartialTextAndPrepare: partialText='$partialText', tasksQueued=$taskCount")
        return partialText
    }

    /**
     * Phase 2: Actually hides and removes the overlay.
     * Called by JS after the web input is ready and focused.
     */
    fun hide() {
        removeLayoutListener()

        overlayView?.animate()
            ?.alpha(0f)
            ?.setDuration(150)
            ?.withEndAction { removeOverlayView() }
            ?.start()

        Log.d(TAG, "Startup overlay hidden")
    }

    /**
     * Dismiss without partial text transfer.
     */
    fun dismiss() {
        removeLayoutListener()

        if (isBarVisible) {
            val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            editText?.let { imm?.hideSoftInputFromWindow(it.windowToken, 0) }

            barView?.animate()
                ?.translationY(200f)
                ?.alpha(0f)
                ?.setDuration(250)
                ?.setInterpolator(AccelerateInterpolator())
                ?.withEndAction { removeOverlayView() }
                ?.start()
        } else {
            // FAB still showing — remove immediately
            removeOverlayView()
        }

        Log.d(TAG, "Startup overlay dismissed")
    }

    private fun removeLayoutListener() {
        val observer = activity.findViewById<View>(android.R.id.content)?.viewTreeObserver
        layoutListener?.let { observer?.removeOnGlobalLayoutListener(it) }
        layoutListener = null
        insetLayoutListener?.let { observer?.removeOnGlobalLayoutListener(it) }
        insetLayoutListener = null
    }

    private fun removeOverlayView() {
        (overlayView?.parent as? ViewGroup)?.removeView(overlayView)
        overlayView = null
        fab = null
        editText = null
        feedbackText = null
        barView = null
    }

    companion object {
        private const val TAG = "StartupOverlay"

        // Base bottom gaps (dp) above the WebView's bottom inset. The FAB mirrors
        // the web bottom-nav button, whose bottom edge sits ~6dp above the nav
        // line (measured). The input bar adds 36dp on top to clear the web
        // add-task-bar's action-button row. Fine-tune here if a device shows a
        // small constant offset (these are now device-independent of nav type).
        private const val FAB_GAP_DP = 6
        private const val BAR_GAP_DP = 6 + 36
    }
}
