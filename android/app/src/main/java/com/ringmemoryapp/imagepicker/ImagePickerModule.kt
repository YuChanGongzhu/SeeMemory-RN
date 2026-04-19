package com.ringmemoryapp.imagepicker

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class ImagePickerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "ImagePickerModule"
        private const val PICK_IMAGE_REQUEST_CODE = 20481
    }

    private var pendingPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun pickImage(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No active activity available")
            return
        }
        if (pendingPromise != null) {
            promise.reject("PICK_IN_PROGRESS", "Image picking is already in progress")
            return
        }

        pendingPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        activity.startActivityForResult(intent, PICK_IMAGE_REQUEST_CODE)
    }

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != PICK_IMAGE_REQUEST_CODE) {
            return
        }

        val promise = pendingPromise
        pendingPromise = null

        if (promise == null) {
            return
        }

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            val result = Arguments.createMap()
            result.putBoolean("didCancel", true)
            promise.resolve(result)
            return
        }

        try {
            val uri = data.data!!
            val copied = copyUriToCache(uri)
            val imageSize = readImageSize(copied.absolutePath)

            val result = Arguments.createMap().apply {
                putBoolean("didCancel", false)
                putString("filePath", copied.absolutePath)
                putString("uri", uri.toString())
                putString("fileName", copied.name)
                putString("mimeType", reactContext.contentResolver.getType(uri) ?: guessMimeType(copied.name))
                putDouble("fileSize", copied.length().toDouble())
                imageSize.first?.let { putInt("width", it) }
                imageSize.second?.let { putInt("height", it) }
            }
            promise.resolve(result)
        } catch (error: Exception) {
            promise.reject("PICK_FAILED", error.message, error)
        }
    }

    override fun onNewIntent(intent: Intent?) = Unit

    private fun copyUriToCache(uri: Uri): File {
        val fileName = resolveDisplayName(uri)
        val extension = fileName.substringAfterLast('.', "").ifBlank {
            mimeTypeToExtension(reactContext.contentResolver.getType(uri))
        }
        val safeExtension = extension.ifBlank { "jpg" }
        val outputDir = File(reactContext.cacheDir, "chat-images").apply {
            mkdirs()
        }
        val outputFile = File(outputDir, "${UUID.randomUUID()}.$safeExtension")
        reactContext.contentResolver.openInputStream(uri).use { input ->
            if (input == null) {
                throw IllegalStateException("Unable to open selected image")
            }
            FileOutputStream(outputFile).use { output ->
                input.copyTo(output)
            }
        }
        return outputFile
    }

    private fun resolveDisplayName(uri: Uri): String {
        var cursor: Cursor? = null
        return try {
            cursor = reactContext.contentResolver.query(uri, null, null, null, null)
            val nameIndex = cursor?.getColumnIndex(OpenableColumns.DISPLAY_NAME) ?: -1
            if (cursor != null && cursor.moveToFirst() && nameIndex >= 0) {
                cursor.getString(nameIndex) ?: "image.jpg"
            } else {
                "image.jpg"
            }
        } finally {
            cursor?.close()
        }
    }

    private fun readImageSize(path: String): Pair<Int?, Int?> {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
        }
        BitmapFactory.decodeFile(path, options)
        val width = options.outWidth.takeIf { it > 0 }
        val height = options.outHeight.takeIf { it > 0 }
        return width to height
    }

    private fun mimeTypeToExtension(mimeType: String?): String {
        return when (mimeType?.lowercase()) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/heic" -> "heic"
            "image/heif" -> "heif"
            else -> "jpg"
        }
    }

    private fun guessMimeType(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            else -> "image/jpeg"
        }
    }
}
