package com.superproductivity.superproductivity.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.superproductivity.superproductivity.CapacitorMainActivity
import com.superproductivity.superproductivity.BuildConfig
import com.superproductivity.superproductivity.R
import com.superproductivity.superproductivity.receiver.ReminderActionReceiver

/**
 * Keeps task reminder overlays visible while the user is in another app.
 * The normal reminder notification remains available as a system fallback.
 */
class ReminderOverlayService : Service() {

    private data class Reminder(
        val notificationId: Int,
        val reminderId: String,
        val relatedId: String,
        val title: String,
        val reminderType: String,
        val useAlarmStyle: Boolean,
        val isOngoing: Boolean,
    )

    private val windows = mutableMapOf<Int, View>()
    private lateinit var windowManager: WindowManager

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != ACTION_SHOW) {
            stopSelf(startId)
            return START_NOT_STICKY
        }

        try {
            startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
        } catch (e: Exception) {
            Log.e(TAG, "Unable to keep reminder overlay running", e)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        if (!canDrawOverlays(this)) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        val reminder = Reminder(
            notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, -1),
            reminderId = intent.getStringExtra(EXTRA_REMINDER_ID) ?: "",
            relatedId = intent.getStringExtra(EXTRA_RELATED_ID) ?: "",
            title = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.overlay_task_reminder),
            reminderType = intent.getStringExtra(EXTRA_REMINDER_TYPE) ?: "TASK",
            useAlarmStyle = intent.getBooleanExtra(EXTRA_USE_ALARM_STYLE, false),
            isOngoing = intent.getBooleanExtra(EXTRA_IS_ONGOING, false),
        )
        if (reminder.notificationId != -1) showReminder(reminder)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        windows.values.forEach(::removeWindow)
        windows.clear()
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun showReminder(reminder: Reminder) {
        windows.remove(reminder.notificationId)?.let(::removeWindow)
        val view = createOverlay(reminder)
        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
            },
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }

        try {
            windowManager.addView(view, layoutParams)
            windows[reminder.notificationId] = view
        } catch (e: Exception) {
            Log.e(TAG, "Unable to show reminder overlay", e)
            stopIfEmpty()
        }
    }

    private fun createOverlay(reminder: Reminder): View {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(190, 0, 0, 0))
            isClickable = true
            isFocusable = true
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(20))
            background = GradientDrawable().apply {
                setColor(ContextCompat.getColor(this@ReminderOverlayService, R.color.widget_bg))
                cornerRadius = dp(18).toFloat()
            }
            elevation = dp(12).toFloat()
        }

        val heading = TextView(this).apply {
            text = getString(R.string.overlay_task_reminder)
            setTextColor(ContextCompat.getColor(this@ReminderOverlayService, R.color.widget_ink_muted))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        }
        val taskTitle = TextView(this).apply {
            text = reminder.title
            setTextColor(ContextCompat.getColor(this@ReminderOverlayService, R.color.widget_ink))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setPadding(0, dp(8), 0, dp(20))
        }
        card.addView(heading)
        card.addView(taskTitle)
        card.addView(actionButton(R.string.overlay_done, true) {
            sendAction(reminder, ReminderActionReceiver.ACTION_DONE)
        })
        card.addView(actionButton(R.string.overlay_snooze_10m, false) {
            sendAction(reminder, ReminderActionReceiver.ACTION_SNOOZE)
        })
        card.addView(actionButton(R.string.overlay_snooze_1h, false) {
            sendAction(reminder, ReminderActionReceiver.ACTION_SNOOZE_1H)
        })

        root.addView(
            card,
            FrameLayout.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ).apply {
                leftMargin = dp(24)
                rightMargin = dp(24)
            },
        )
        return root
    }

    private fun actionButton(
        textRes: Int,
        isPrimary: Boolean,
        onClick: () -> Unit,
    ): Button = Button(this).apply {
        text = getString(textRes)
        isAllCaps = false
        setOnClickListener { onClick() }
        if (isPrimary) {
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(ContextCompat.getColor(this@ReminderOverlayService, R.color.widget_brand))
                cornerRadius = dp(8).toFloat()
            }
        }
    }

    private fun sendAction(reminder: Reminder, action: String) {
        val actionIntent = Intent(this, ReminderActionReceiver::class.java).apply {
            this.action = action
            putExtra(ReminderActionReceiver.EXTRA_NOTIFICATION_ID, reminder.notificationId)
            putExtra(ReminderActionReceiver.EXTRA_REMINDER_ID, reminder.reminderId)
            putExtra(ReminderActionReceiver.EXTRA_RELATED_ID, reminder.relatedId)
            putExtra(ReminderActionReceiver.EXTRA_TITLE, reminder.title)
            putExtra(ReminderActionReceiver.EXTRA_REMINDER_TYPE, reminder.reminderType)
            putExtra(ReminderActionReceiver.EXTRA_USE_ALARM_STYLE, reminder.useAlarmStyle)
            putExtra(ReminderActionReceiver.EXTRA_IS_ONGOING, reminder.isOngoing)
        }
        val requestCode = when (action) {
            ReminderActionReceiver.ACTION_DONE -> reminder.notificationId xor 0x10000000
            ReminderActionReceiver.ACTION_SNOOZE -> reminder.notificationId xor 0x20000000
            else -> reminder.notificationId xor 0x30000000
        }
        val pendingIntent = PendingIntent.getBroadcast(
            this,
            requestCode,
            actionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        try {
            pendingIntent.send()
        } catch (e: PendingIntent.CanceledException) {
            Log.e(TAG, "Reminder action could not be delivered", e)
        }
    }

    private fun buildForegroundNotification(): Notification {
        createNotificationChannel()
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, CapacitorMainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sp)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.overlay_service_notification))
            .setContentIntent(openAppIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.overlay_service_channel),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.overlay_service_channel_description)
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun dismissReminder(notificationId: Int) {
        windows.remove(notificationId)?.let(::removeWindow)
        stopIfEmpty()
    }

    private fun removeWindow(view: View) {
        try {
            windowManager.removeView(view)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "Reminder overlay was already removed", e)
        }
    }

    private fun stopIfEmpty() {
        if (windows.isEmpty()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val TAG = "ReminderOverlayService"
        private const val ACTION_SHOW = "com.superproductivity.ACTION_SHOW_REMINDER_OVERLAY"
        private const val EXTRA_NOTIFICATION_ID = "notification_id"
        private const val EXTRA_REMINDER_ID = "reminder_id"
        private const val EXTRA_RELATED_ID = "related_id"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_REMINDER_TYPE = "reminder_type"
        private const val EXTRA_USE_ALARM_STYLE = "use_alarm_style"
        private const val EXTRA_IS_ONGOING = "is_ongoing"
        private const val FOREGROUND_NOTIFICATION_ID = Int.MAX_VALUE - 1
        private const val CHANNEL_ID = "sp_reminder_overlay_service"
        private val OVERLAY_REMINDER_TYPES = setOf("TASK", "DUE_DATE", "DEADLINE")

        @Volatile
        private var instance: ReminderOverlayService? = null

        fun canDrawOverlays(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

        internal fun supportsReminderType(reminderType: String): Boolean =
            reminderType in OVERLAY_REMINDER_TYPES

        fun showIfAllowed(
            context: Context,
            notificationId: Int,
            reminderId: String,
            relatedId: String,
            title: String,
            reminderType: String,
            useAlarmStyle: Boolean,
            isOngoing: Boolean,
        ): Boolean {
            if (BuildConfig.BUILD_TYPE != "plus" ||
                !canDrawOverlays(context) ||
                !supportsReminderType(reminderType)
            ) {
                return false
            }

            val intent = Intent(context, ReminderOverlayService::class.java).apply {
                action = ACTION_SHOW
                putExtra(EXTRA_NOTIFICATION_ID, notificationId)
                putExtra(EXTRA_REMINDER_ID, reminderId)
                putExtra(EXTRA_RELATED_ID, relatedId)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_REMINDER_TYPE, reminderType)
                putExtra(EXTRA_USE_ALARM_STYLE, useAlarmStyle)
                putExtra(EXTRA_IS_ONGOING, isOngoing)
            }
            return try {
                ContextCompat.startForegroundService(context, intent)
                true
            } catch (e: Exception) {
                Log.e(TAG, "Unable to start reminder overlay service", e)
                false
            }
        }

        fun dismiss(notificationId: Int) {
            val service = instance ?: return
            Handler(Looper.getMainLooper()).post { service.dismissReminder(notificationId) }
        }
    }
}
