package com.superproductivity.superproductivity.plugins

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Process
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter

@CapacitorPlugin(name = "SafBridge")
class SafBridgePlugin : Plugin() {

    companion object {
        const val REQUEST_CODE_OPEN_DOCUMENT_TREE = 42
    }

    @PluginMethod
    fun selectFolder(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
        }
        
        startActivityForResult(call, intent, "handleFolderSelectionResult")
    }

    @ActivityCallback
    private fun handleFolderSelectionResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            val resultData = result.data
            val uri = resultData?.data
            if (uri != null) {
                // Use only the flags that were actually granted by the result intent.
                // Applying flags not present in the result throws SecurityException on some devices.
                // resultData is Intent? but uri != null proves resultData is non-null here;
                // Kotlin cannot infer this transitively, so !! is required and safe.
                val grantedFlags = resultData!!.flags and
                        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                try {
                    context.contentResolver.takePersistableUriPermission(uri, grantedFlags)
                } catch (e: SecurityException) {
                    // Some devices/OEM ROMs fail to persist SAF permission even when
                    // FLAG_GRANT_PERSISTABLE_URI_PERMISSION was requested. Fall through and
                    // still return the URI — it will work for this session even if it can't
                    // be persisted across reboots (user will need to re-select next launch).
                    android.util.Log.w(
                        "SafBridgePlugin",
                        "Could not persist URI permission (session-only access): ${e.message}",
                    )
                }

                val ret = JSObject()
                ret.put("uri", uri.toString())
                call.resolve(ret)
            } else {
                call.reject("No folder selected")
            }
        } else {
            call.reject("Folder selection cancelled")
        }
    }

    @PluginMethod
    fun readFile(call: PluginCall) {
        val uriString = call.getString("uri") ?: run {
            call.reject("URI is required")
            return
        }
        val fileName = call.getString("fileName") ?: run {
            call.reject("fileName is required")
            return
        }

        try {
            val treeUri = Uri.parse(uriString)
            val documentFile = DocumentFile.fromTreeUri(context, treeUri)
            val file = documentFile?.findFile(fileName)

            if (file == null || !file.exists()) {
                call.reject("File not found: $fileName")
                return
            }

            val inputStream = context.contentResolver.openInputStream(file.uri)
            val reader = BufferedReader(InputStreamReader(inputStream))
            val content = reader.use { it.readText() }

            val ret = JSObject()
            ret.put("data", content)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to read file: ${e.message}")
        }
    }

    @PluginMethod
    fun writeFile(call: PluginCall) {
        val uriString = call.getString("uri") ?: run {
            call.reject("URI is required")
            return
        }
        val fileName = call.getString("fileName") ?: run {
            call.reject("fileName is required")
            return
        }
        val data = call.getString("data") ?: run {
            call.reject("data is required")
            return
        }

        try {
            val treeUri = Uri.parse(uriString)
            val documentFile = DocumentFile.fromTreeUri(context, treeUri)
            
            // Check if file exists and delete it
            var file = documentFile?.findFile(fileName)
            if (file != null && file.exists()) {
                file.delete()
            }

            // Create new file
            file = documentFile?.createFile("application/octet-stream", fileName)
            if (file == null) {
                call.reject("Failed to create file")
                return
            }

            val outputStream = context.contentResolver.openOutputStream(file.uri)
            val writer = OutputStreamWriter(outputStream)
            writer.use { it.write(data) }

            val ret = JSObject()
            ret.put("success", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to write file: ${e.message}")
        }
    }

    @PluginMethod
    fun deleteFile(call: PluginCall) {
        val uriString = call.getString("uri") ?: run {
            call.reject("URI is required")
            return
        }
        val fileName = call.getString("fileName") ?: run {
            call.reject("fileName is required")
            return
        }

        try {
            val treeUri = Uri.parse(uriString)
            val documentFile = DocumentFile.fromTreeUri(context, treeUri)
            val file = documentFile?.findFile(fileName)

            if (file == null || !file.exists()) {
                // File doesn't exist, consider it a success
                val ret = JSObject()
                ret.put("success", true)
                call.resolve(ret)
                return
            }

            val deleted = file.delete()
            val ret = JSObject()
            ret.put("success", deleted)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to delete file: ${e.message}")
        }
    }

    @PluginMethod
    fun checkFileExists(call: PluginCall) {
        val uriString = call.getString("uri") ?: run {
            call.reject("URI is required")
            return
        }
        val fileName = call.getString("fileName") ?: run {
            call.reject("fileName is required")
            return
        }

        try {
            val treeUri = Uri.parse(uriString)
            val documentFile = DocumentFile.fromTreeUri(context, treeUri)
            val file = documentFile?.findFile(fileName)

            val ret = JSObject()
            ret.put("exists", file != null && file.exists())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to check file existence: ${e.message}")
        }
    }

    @PluginMethod
    fun checkUriPermission(call: PluginCall) {
        val uriString = call.getString("uri") ?: run {
            call.reject("URI is required")
            return
        }

        try {
            val uri = Uri.parse(uriString)
            // Check both persistent grants (survive reboots) and temporary session grants
            // (active for current app session only). This is required to support devices/OEM
            // ROMs where takePersistableUriPermission throws SecurityException — on those
            // devices the session grant is still valid even though it could not be persisted.
            val pid = Process.myPid()
            val uid = Process.myUid()
            val canRead = context.checkUriPermission(
                uri, pid, uid, Intent.FLAG_GRANT_READ_URI_PERMISSION,
            ) == PackageManager.PERMISSION_GRANTED
            val canWrite = context.checkUriPermission(
                uri, pid, uid, Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            ) == PackageManager.PERMISSION_GRANTED
            val hasPermission = canRead && canWrite

            val ret = JSObject()
            ret.put("hasPermission", hasPermission)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to check URI permission: ${e.message}")
        }
    }
}