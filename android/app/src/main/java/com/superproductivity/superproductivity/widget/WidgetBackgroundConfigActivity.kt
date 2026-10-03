package com.superproductivity.superproductivity.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.View
import android.widget.GridLayout
import android.widget.SeekBar
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.setMargins
import com.superproductivity.superproductivity.R

/**
 * android.appwidget.action.APPWIDGET_CONFIGURE target for both widget
 * providers (appWidgetId is unique across types, so one screen + one prefs
 * store in [WidgetBackground] covers both). Shown on first add, and again
 * from the launcher's long-press "Edit" once android:configure is set on
 * the provider's appwidget-info.
 */
class WidgetBackgroundConfigActivity : AppCompatActivity() {

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private var selectedColor = 0

    private val presetColors = intArrayOf(
        Color.parseColor("#F8F8F7"),
        Color.parseColor("#131314"),
        Color.parseColor("#8B4A9D"),
        Color.parseColor("#0B77D2"),
        Color.parseColor("#2E7D32"),
        Color.parseColor("#EF6C00"),
        Color.parseColor("#C62828"),
        Color.parseColor("#455A64")
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Widget config contract: cancel unless the user explicitly saves below.
        setResult(Activity.RESULT_CANCELED)
        setContentView(R.layout.activity_widget_background_config)

        appWidgetId = intent.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        selectedColor = WidgetBackground.getColor(this, appWidgetId)
        val preview = findViewById<View>(R.id.widget_config_preview)
        val alphaSeekBar = findViewById<SeekBar>(R.id.widget_config_alpha)
        alphaSeekBar.progress = Color.alpha(selectedColor) * 100 / 255
        updatePreview(preview)

        buildSwatches(alphaSeekBar, preview)

        alphaSeekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                selectedColor = withAlpha(selectedColor, progress)
                updatePreview(preview)
            }

            override fun onStartTrackingTouch(seekBar: SeekBar) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar) = Unit
        })

        findViewById<View>(R.id.widget_config_save).setOnClickListener {
            WidgetBackground.setColor(this, appWidgetId, selectedColor)
            refreshOwningWidget()
            setResult(
                Activity.RESULT_OK,
                Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            )
            finish()
        }
    }

    private fun buildSwatches(alphaSeekBar: SeekBar, preview: View) {
        val names = resources.getStringArray(R.array.widget_config_swatch_names)
        val grid = findViewById<GridLayout>(R.id.widget_config_swatches)
        val sizePx = (40 * resources.displayMetrics.density).toInt()
        val marginPx = (6 * resources.displayMetrics.density).toInt()
        presetColors.forEachIndexed { i, rgb ->
            val swatch = View(this).apply {
                contentDescription = names.getOrNull(i)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = sizePx / 4f
                    setColor(rgb)
                }
                setOnClickListener {
                    selectedColor = withAlpha(rgb, alphaSeekBar.progress)
                    updatePreview(preview)
                }
            }
            val params = GridLayout.LayoutParams().apply {
                width = sizePx
                height = sizePx
                setMargins(marginPx)
            }
            grid.addView(swatch, params)
        }
    }

    private fun withAlpha(color: Int, alphaPercent: Int): Int =
        Color.argb(alphaPercent * 255 / 100, Color.red(color), Color.green(color), Color.blue(color))

    private fun updatePreview(preview: View) {
        WidgetBackground.applyToView(preview, selectedColor)
    }

    private fun refreshOwningWidget() {
        val provider = AppWidgetManager.getInstance(this).getAppWidgetInfo(appWidgetId)?.provider
        when (provider?.className) {
            TrackingWidgetProvider::class.java.name -> TrackingWidgetProvider.refreshAll(this)
            TaskListWidgetProvider::class.java.name -> TaskListWidgetProvider.refreshAll(this)
        }
    }
}
