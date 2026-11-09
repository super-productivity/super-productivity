package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.annotation.ColorRes
import com.superproductivity.superproductivity.R
import kotlin.math.pow

/**
 * Optional per-widget-instance background color + transparency, set from
 * WidgetBackgroundConfigActivity and shared by both widget providers —
 * appWidgetId is unique across widget types, so one prefs store suffices.
 * No stored color means the theme default (@color/widget_bg, light/night).
 */
object WidgetBackground {
    private const val PREFS_NAME = "widget_background_prefs"
    private const val KEY_PREFIX = "argb_"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** The user's color for this widget, or null when it follows the theme. */
    fun getCustomColor(context: Context, appWidgetId: Int): Int? {
        val key = KEY_PREFIX + appWidgetId
        val prefs = prefs(context)
        return if (prefs.contains(key)) prefs.getInt(key, 0) else null
    }

    fun setColor(context: Context, appWidgetId: Int, argb: Int) {
        prefs(context).edit().putInt(KEY_PREFIX + appWidgetId, argb).apply()
    }

    fun remove(context: Context, appWidgetIds: IntArray) {
        val editor = prefs(context).edit()
        for (id in appWidgetIds) {
            editor.remove(KEY_PREFIX + id)
        }
        editor.apply()
    }

    fun styleFor(context: Context, appWidgetId: Int): WidgetStyle =
        WidgetStyle(getCustomColor(context, appWidgetId))

    /** Mirrors the RemoteViews background branching in [WidgetStyle], for the config preview. */
    fun applyToView(view: View, argb: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            view.backgroundTintList = ColorStateList.valueOf(argb)
        } else {
            view.setBackgroundColor(argb)
        }
    }
}

/** Foreground roles; the resource is the theme-default color for that role. */
enum class WidgetInk(@ColorRes val res: Int) {
    INK(R.color.widget_ink),
    MUTED(R.color.widget_ink_muted),
    SEPARATOR(R.color.widget_separator),
    BRAND(R.color.widget_brand)
}

/**
 * Background + matching foreground colors for one widget instance.
 *
 * Theme default ([customBg] null): the layouts' @color resources already follow
 * light/night, so nothing is pinned — on API 31+ the colors are re-set as
 * resource references (resolved by the launcher at apply time), which clears
 * any custom color a reapplied RemoteViews would otherwise keep after "Use
 * theme default". Below API 31 widgets can't be reconfigured, so there is
 * nothing to clear.
 *
 * Custom: a fixed palette picked for contrast against [customBg], since the
 * theme's ink can be the same lightness as the chosen color (#10328).
 *
 * RemoteViews can only reach a view's real setters, so recoloring the rounded
 * @drawable/widget_bg needs backgroundTintList (setColorStateList, API 31+).
 * Below that, fall back to a flat setBackgroundColor — square corners.
 */
class WidgetStyle(private val customBg: Int?) {
    private val palette: Map<WidgetInk, Int>? = customBg?.let { paletteFor(it) }

    fun applyBackground(views: RemoteViews, viewId: Int) {
        when {
            customBg == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                views.setColorStateList(viewId, "setBackgroundTintList", null as ColorStateList?)
            customBg == null -> Unit
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                views.setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(customBg))
            else -> views.setInt(viewId, "setBackgroundColor", customBg)
        }
    }

    fun text(views: RemoteViews, viewId: Int, ink: WidgetInk) = set(views, viewId, "setTextColor", ink)

    /**
     * For a color that varies per row state (done/undone), where a recycled
     * list row must never keep the previous state's color: below API 31 the
     * theme default can't be set as a resource reference, so it is pinned.
     */
    fun stateText(context: Context, views: RemoteViews, viewId: Int, ink: WidgetInk) {
        if (palette == null && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            views.setTextColor(viewId, context.getColor(ink.res))
        } else {
            text(views, viewId, ink)
        }
    }

    /** Tints an ImageView; a color filter takes precedence over the drawable's own tint. */
    fun icon(views: RemoteViews, viewId: Int, ink: WidgetInk) = set(views, viewId, "setColorFilter", ink)

    fun fill(views: RemoteViews, viewId: Int, ink: WidgetInk) = set(views, viewId, "setBackgroundColor", ink)

    private fun set(views: RemoteViews, viewId: Int, method: String, ink: WidgetInk) {
        val color = palette?.get(ink)
        if (color != null) {
            views.setInt(viewId, method, color)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColor(viewId, method, ink.res)
        }
    }

    companion object {
        // values/colors.xml's light-theme ink. The dark side uses pure white
        // rather than the night theme's #E6E6E6, which falls below WCAG AA on
        // mid-tone swatches such as green.
        private val ON_LIGHT = mapOf(
            WidgetInk.INK to 0xDE000000.toInt(),
            WidgetInk.MUTED to 0x8A000000.toInt(),
            WidgetInk.SEPARATOR to 0x1F000000
        )
        private val ON_DARK = mapOf(
            WidgetInk.INK to 0xFFFFFFFF.toInt(),
            WidgetInk.MUTED to 0xB3FFFFFF.toInt(),
            WidgetInk.SEPARATOR to 0x33FFFFFF
        )
        private const val BRAND_ON_LIGHT = 0xFF8B4A9D.toInt()
        private const val BRAND_ON_DARK = 0xFFA05DB1.toInt()

        /** WCAG minimum for non-text UI (icons); below it the brand tint falls back to ink. */
        private const val MIN_ICON_CONTRAST = 3.0

        /** Pure (no Android color APIs) so it runs in JVM unit tests. Alpha is ignored. */
        fun paletteFor(bg: Int): Map<WidgetInk, Int> {
            val isDark = isDarkBackground(bg)
            val base = if (isDark) ON_DARK else ON_LIGHT
            val brand = if (isDark) BRAND_ON_DARK else BRAND_ON_LIGHT
            val accent = if (contrast(brand, bg) >= MIN_ICON_CONTRAST) brand else base.getValue(WidgetInk.INK)
            return base + (WidgetInk.BRAND to accent)
        }

        /** True when white text out-contrasts black on [bg] (WCAG relative luminance). */
        fun isDarkBackground(bg: Int): Boolean =
            contrastRatio(1.0, luminance(bg)) > contrastRatio(luminance(bg), 0.0)

        fun contrast(a: Int, b: Int): Double = contrastRatio(luminance(a), luminance(b))

        private fun contrastRatio(l1: Double, l2: Double): Double =
            (maxOf(l1, l2) + 0.05) / (minOf(l1, l2) + 0.05)

        private fun luminance(argb: Int): Double {
            fun channel(shift: Int): Double {
                val c = ((argb shr shift) and 0xFF) / 255.0
                return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
            }
            return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        }
    }
}
