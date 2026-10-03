package com.superproductivity.superproductivity.widget

import android.content.Context
import android.content.SharedPreferences
import android.content.res.ColorStateList
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.superproductivity.superproductivity.R

/**
 * Per-widget-instance background color + transparency, set from
 * WidgetBackgroundConfigActivity and shared by both widget providers —
 * appWidgetId is unique across widget types, so one prefs store and one
 * apply() suffice for both.
 *
 * The root layouts render a rounded shape (@drawable/widget_bg). RemoteViews
 * can only reach a view's real setters, not arbitrary drawable properties, so
 * recoloring while keeping the rounded corners needs backgroundTintList,
 * which RemoteViews only exposes from API 31 (setColorStateList). Below that,
 * fall back to a flat setBackgroundColor — square corners, but still the
 * user's chosen color/alpha.
 */
object WidgetBackground {
    private const val PREFS_NAME = "widget_background_prefs"
    private const val KEY_PREFIX = "argb_"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getColor(context: Context, appWidgetId: Int): Int {
        val default = ContextCompat.getColor(context, R.color.widget_bg)
        return prefs(context).getInt(KEY_PREFIX + appWidgetId, default)
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

    fun apply(views: RemoteViews, rootViewId: Int, argb: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColorStateList(rootViewId, "setBackgroundTintList", ColorStateList.valueOf(argb))
        } else {
            views.setInt(rootViewId, "setBackgroundColor", argb)
        }
    }

    /** Same branching as [apply], for the live preview in the config screen. */
    fun applyToView(view: View, argb: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            view.backgroundTintList = ColorStateList.valueOf(argb)
        } else {
            view.setBackgroundColor(argb)
        }
    }
}
