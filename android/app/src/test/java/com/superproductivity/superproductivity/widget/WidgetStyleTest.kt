package com.superproductivity.superproductivity.widget

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetStyleTest {

    // Config-screen swatches: Light, Dark, Purple, Blue, Green, Orange, Red, Slate.
    private val swatches = intArrayOf(
        0xFFF8F8F7.toInt(), 0xFF131314.toInt(), 0xFF8B4A9D.toInt(), 0xFF0B77D2.toInt(),
        0xFF2E7D32.toInt(), 0xFFEF6C00.toInt(), 0xFFC62828.toInt(), 0xFF455A64.toInt()
    )

    @Test
    fun lightBackgroundGetsDarkInkAndDarkGetsLightInk() {
        // The #10328 review cases: Dark chosen in light mode, Light in dark mode.
        assertFalse(WidgetStyle.isDarkBackground(0xFFF8F8F7.toInt()))
        assertTrue(WidgetStyle.isDarkBackground(0xFF131314.toInt()))
        assertEquals(0xDE000000.toInt(), WidgetStyle.paletteFor(0xFFF8F8F7.toInt())[WidgetInk.INK])
        assertEquals(0xFFFFFFFF.toInt(), WidgetStyle.paletteFor(0xFF131314.toInt())[WidgetInk.INK])
    }

    @Test
    fun alphaDoesNotChangeThePick() {
        assertTrue(WidgetStyle.isDarkBackground(0x40131314))
    }

    @Test
    fun everySwatchGetsReadableTextAndIcons() {
        for (bg in swatches) {
            val palette = WidgetStyle.paletteFor(bg)
            val opaqueInk = palette.getValue(WidgetInk.INK) or 0xFF000000.toInt()
            // WCAG AA for normal text, judged on the ink's opaque color.
            assertTrue(
                "ink on #${Integer.toHexString(bg)}",
                WidgetStyle.contrast(opaqueInk, bg) >= 4.5
            )
            assertTrue(
                "brand on #${Integer.toHexString(bg)}",
                WidgetStyle.contrast(palette.getValue(WidgetInk.BRAND) or 0xFF000000.toInt(), bg) >= 3.0
            )
        }
    }

    @Test
    fun brandFallsBackToInkOnAPurpleBackground() {
        val purple = 0xFF8B4A9D.toInt()
        val palette = WidgetStyle.paletteFor(purple)
        assertEquals(palette[WidgetInk.INK], palette[WidgetInk.BRAND])
    }
}
