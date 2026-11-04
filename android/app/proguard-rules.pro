# R8 rules for the release build.
#
# Release builds still run with minifyEnabled false (see build.gradle for why —
# enabling it shipped a startup crash to the Play internal track), so these rules
# do not affect anything that ships today. They are NOT inert, though:
# android/run-android-checks.sh minifies the r8Test build type on every Android
# PR and then checks it two ways — it launches the APK, so the rules the smoke
# page actually uses are proven on a running app, and it reads the mapping, so
# the rules nothing at startup exercises are proven to have survived R8. Each
# rule below names which one covers it.
#
# That is also the only validation they have. Treat them as a starting point for
# the re-land ahead of Google Play's February 2027 DEX shrinking/obfuscation
# requirement.
#
# Everything R8 cannot see statically has to be kept here — reflection and the
# WebView bridge both look like dead code to it.

# --- WebView JS bridge ------------------------------------------------------
# The Angular app calls these methods by name off the injected window property,
# so R8 must neither rename nor drop them. Redundant today: the AGP default
# proguard file keeps @JavascriptInterface members globally.
# Kept because it names the one class we actually depend on, and because the
# failure is silent — a stripped bridge method builds and installs fine, the JS
# call just goes nowhere. Covered twice: tools/verify-r8-mapping.mjs checks the
# mapping, and the smoke page calls SUPAndroid.getVersion() on the minified APK.
-keepclassmembers class com.superproductivity.superproductivity.webview.JavaScriptInterface {
    @android.webkit.JavascriptInterface <methods>;
}

# --- WorkManager ------------------------------------------------------------
# Workers are instantiated reflectively from the class name persisted in the
# WorkManager database. Redundant today, and measurably so — dropping this rule
# still leaves SyncReminderWorker un-renamed, because SyncReminderScheduler
# names the class through PeriodicWorkRequestBuilder<SyncReminderWorker>, so R8
# keeps it and work-runtime's own -keepnames preserves the name. It stops being
# redundant as soon as a worker is only ever referenced as a string: -keepnames
# permits shrinking, so R8 would drop it. Same silent failure as above, and the
# only one of the three with no runtime witness — nothing enqueues a worker at
# startup, so tools/verify-r8-mapping.mjs is all that stands behind it.
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# --- Capacitor plugin permissions -------------------------------------------
# Load-bearing, and the cause of #9785 / #9793: nothing in the program ever
# constructs a @CapacitorPlugin — annotation instances are runtime-generated
# proxies — so R8 concludes PluginHandle.pluginAnnotation can only ever hold
# null. It deletes the field and constant-folds every read, which compiles
# Plugin.getPermissionStates(), requestPermissions(), requestPermissionForAliases()
# and pluginRequestAllPermissions() down to a literal `throw null`. On device the
# first JS call that touched permissions (LocalNotifications.checkPermissions)
# killed the process ~3s after launch.
#
# Not fixed by keeping the annotation: dexdump confirms @CapacitorPlugin survives
# intact on the plugin classes. Not caused by R8 full mode either — compat mode
# (android.enableR8.fullMode=false) emits the same `throw null`. Keeping the
# field's owner is what stops the fold.
#
# Capacitor's own consumer rules keep the plugin classes but say nothing about
# PluginHandle, so this has to live here.
# Enforced by android/run-android-checks.sh: the smoke page it serves calls
# LocalNotifications.checkPermissions(), the exact call that killed the process
# in #9785. Drop this rule and that smoke goes red.
-keep class com.getcapacitor.PluginHandle { *; }

# --- Tink (via androidx.security-crypto) ------------------------------------
# Tink is annotated with Error Prone annotations that are compile-only and are
# deliberately absent at runtime, so R8 reports them as missing classes. They
# carry no runtime behaviour — suppressing the warning is the documented fix.
-dontwarn com.google.errorprone.annotations.**
