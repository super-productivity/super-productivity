package com.superproductivity.superproductivity.widget

import android.os.Bundle
import android.util.Log
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.superproductivity.superproductivity.R

/**
 * The widget's "+": a small dialog over the home screen. The title goes to the
 * [CaptureInbox] like a share, so no WebView loads. The widget lists it at
 * once; the app adds it to Today (short syntax applied) when it next opens.
 */
class QuickAddActivity : AppCompatActivity() {
    private lateinit var input: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_quick_add)
        input = findViewById(R.id.quick_add_input)
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) save()
            actionId == EditorInfo.IME_ACTION_DONE
        }
        findViewById<Button>(R.id.quick_add_save).setOnClickListener { save() }
        findViewById<Button>(R.id.quick_add_cancel).setOnClickListener { finish() }
    }

    private fun save() {
        // A double tap (button + IME action) must not save the title twice.
        if (isFinishing) return
        val title = input.text.toString()
        if (title.isBlank()) {
            finish()
            return
        }
        val id = try {
            CaptureInbox.forContext(this).add(title, CaptureInbox.SOURCE_WIDGET)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save quick add", e)
            // Keep the dialog open so the typed title is not lost.
            toast(R.string.quick_add_failed)
            return
        }
        // Id only, never the title: logcat ends up in bug reports.
        Log.d(TAG, "Saved quick add $id")
        // Show it in the widget now, as pending (WidgetData.withPendingCaptures).
        TaskListWidgetProvider.refreshAll(this)
        toast(R.string.quick_add_saved)
        finish()
    }

    private fun toast(message: Int) {
        Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val TAG = "SP_QUICK_ADD"
    }
}
