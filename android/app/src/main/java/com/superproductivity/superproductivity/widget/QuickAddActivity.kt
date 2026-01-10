package com.superproductivity.superproductivity.widget

import androidx.appcompat.app.AppCompatActivity
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import com.superproductivity.superproductivity.R

/**
 * A minimal floating dialog activity for quick task entry from the widget.
 * Uses a dialog theme to appear as a floating window.
 */
class QuickAddActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_quick_add)

        // Make it dialog-like with proper sizing
        window.setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT
        )
        setFinishOnTouchOutside(true)

        val editText = findViewById<EditText>(R.id.quick_add_input)
        val addButton = findViewById<Button>(R.id.quick_add_submit)

        addButton.setOnClickListener {
            submitTask(editText)
        }

        // Handle keyboard "done" action
        editText.setOnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_DONE ||
                (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            ) {
                submitTask(editText)
                true
            } else {
                false
            }
        }

        // Show keyboard automatically
        editText.requestFocus()
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
    }

    private fun submitTask(editText: EditText) {
        val title = editText.text.toString().trim()
        if (title.isNotEmpty()) {
            WidgetTaskQueue.addTask(this, title)
            Toast.makeText(this, R.string.widget_task_added, Toast.LENGTH_SHORT).show()
            finish()
        } else {
            Toast.makeText(this, R.string.widget_enter_title, Toast.LENGTH_SHORT).show()
        }
    }
}
