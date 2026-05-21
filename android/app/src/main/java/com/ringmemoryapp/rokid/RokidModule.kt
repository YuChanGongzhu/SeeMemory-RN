package com.ringmemoryapp.rokid

import android.app.Activity
import android.content.Intent
import android.media.MediaPlayer
import android.os.Environment
import android.util.Log
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.rokid.cxr.link.CXRLink
import com.rokid.cxr.link.callbacks.IAudioStreamCbk
import com.rokid.cxr.link.callbacks.ICXRLinkCbk
import com.rokid.cxr.link.callbacks.ICustomViewCbk
import com.rokid.cxr.link.callbacks.IGlassAppCbk
import com.rokid.cxr.link.callbacks.IImageStreamCbk
import com.rokid.cxr.link.utils.CxrDefs
import com.rokid.sprite.aiapp.externalapp.auth.AuthResult
import com.rokid.sprite.aiapp.externalapp.auth.AuthorizationHelper
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class RokidModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "RTNRokidModule"
        private const val TAG = "RokidModule"
        private const val AUTH_REQUEST_CODE = 14021
        private const val DEFAULT_APP_ACTIVITY = "com.rokid.cxrswithcxrl.activities.main.MainActivity"
    }

    private var authPromise: Promise? = null
    private var authToken: String? = null
    private var sceneMode = "customApp"
    private var cxrLink: CXRLink? = null
    private var pendingCustomViewJson: String? = null
    private var pendingCustomViewPromise: Promise? = null
    private var pendingCustomAppActivity: String? = null
    private var pendingCustomAppUrl: String = ""
    private var pendingCustomAppPromise: Promise? = null
    private var pendingQueryAppPromise: Promise? = null
    private var isCxrConnected = false
    private var isGlassBtConnected = false
    private var isCustomViewOpened = false
    private var isCustomAppOpened = false
    private var isRecording = false
    private var recordStartedAt = 0L
    private val audioBuffer = ByteArrayOutputStream()
    private var mediaPlayer: MediaPlayer? = null

    private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != AUTH_REQUEST_CODE) {
                return
            }
            handleAuthorizationResult(resultCode, data)
        }
    }

    private val linkCallback = object : ICXRLinkCbk {
        override fun onCXRLConnected(connected: Boolean) {
            isCxrConnected = connected
            emit("onRokidSessionStateChanged", Arguments.createMap().apply {
                putBoolean("cxrConnected", isCxrConnected)
                putBoolean("glassBtConnected", isGlassBtConnected)
                putString("mode", sceneMode)
            })
            tryRunPendingSceneAction()
        }

        override fun onGlassBtConnected(connected: Boolean) {
            isGlassBtConnected = connected
            emit("onRokidSessionStateChanged", Arguments.createMap().apply {
                putBoolean("cxrConnected", isCxrConnected)
                putBoolean("glassBtConnected", isGlassBtConnected)
                putString("mode", sceneMode)
            })
            tryRunPendingSceneAction()
        }

        override fun onGlassAiAssistStart() {}
        override fun onGlassAiAssistStop() {}
    }

    private val customViewCallback = object : ICustomViewCbk {
        override fun onCustomViewOpened() {
            isCustomViewOpened = true
            emit("onRokidCustomViewRunning", Arguments.createMap().apply {
                putBoolean("isRunning", true)
            })
            pendingCustomViewPromise?.resolve(Arguments.createMap().apply {
                putBoolean("success", true)
            })
            pendingCustomViewPromise = null
        }

        override fun onCustomViewUpdated() {}

        override fun onCustomViewClosed() {
            isCustomViewOpened = false
            emit("onRokidCustomViewRunning", Arguments.createMap().apply {
                putBoolean("isRunning", false)
            })
        }

        override fun onCustomViewIconsSent() {}

        override fun onCustomViewError(code: Int, message: String?) {
            isCustomViewOpened = false
            val error = message ?: "Custom view error"
            emitError("$error ($code)")
            pendingCustomViewPromise?.reject("ROKID_CUSTOM_VIEW_ERROR", "$error ($code)")
            pendingCustomViewPromise = null
        }
    }

    private val appCallback = object : IGlassAppCbk {
        override fun onInstallAppResult(success: Boolean) {}

        override fun onUnInstallAppResult(success: Boolean) {}

        override fun onOpenAppResult(success: Boolean) {
            isCustomAppOpened = success
            pendingCustomAppPromise?.resolve(Arguments.createMap().apply {
                putBoolean("success", success)
            })
            pendingCustomAppPromise = null
        }

        override fun onStopAppResult(success: Boolean) {
            isCustomAppOpened = !success
        }

        override fun onGlassAppResume(resumed: Boolean) {
            isCustomAppOpened = resumed
            emit("onRokidAppResumeChanged", Arguments.createMap().apply {
                putString("packageName", "com.rokid.cxrswithcxrl")
                putBoolean("resumed", resumed)
            })
        }

        override fun onQueryAppResult(installed: Boolean) {
            pendingQueryAppPromise?.resolve(Arguments.createMap().apply {
                putBoolean("installed", installed)
                putString("packageName", "com.rokid.cxrswithcxrl")
            })
            pendingQueryAppPromise = null
        }
    }

    private val audioCallback = object : IAudioStreamCbk {
        override fun onAudioReceived(data: ByteArray?, offset: Int, length: Int) {
            if (data == null || length <= 0) {
                return
            }
            val safeOffset = if (offset in data.indices) offset else 0
            val maxAvailable = data.size - safeOffset
            val safeLength = when {
                length in 1..maxAvailable -> length
                maxAvailable > 0 -> maxAvailable
                else -> 0
            }
            if (safeLength <= 0) {
                return
            }
            if (isRecording) {
                audioBuffer.write(data, safeOffset, safeLength)
            }
            emit("onRokidAudioData", Arguments.createMap().apply {
                putString("event", "stream")
                putInt("size", safeLength)
                putDouble("timestamp", System.currentTimeMillis().toDouble())
            })
        }

        override fun onAudioError(errorCode: Int, errorInfo: String?) {
            isRecording = false
            emitError("Audio stream error $errorCode: ${errorInfo ?: ""}")
        }

        override fun onAudioStreamStateChanged(started: Boolean) {
            emit("onRokidAudioData", Arguments.createMap().apply {
                putString("event", if (started) "started" else "stopped")
            })
        }
    }

    private val imageCallback = object : IImageStreamCbk {
        override fun onImageReceived(data: ByteArray?) {
            if (data == null || data.isEmpty()) {
                emitError("Photo callback returned empty data")
                return
            }
            try {
                val payload = savePhoto(data)
                emit("onRokidPhotoReady", payload)
            } catch (e: Exception) {
                emitError("Failed to save photo: ${e.message}")
            }
        }

        override fun onImageError(code: Int, msg: String?) {
            emitError("Photo error $code: ${msg ?: ""}")
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    fun initializeClient(mode: String, appDisplayName: String?, pageName: String?, promise: Promise) {
        sceneMode = if (mode == "customView") "customView" else "customApp"
        promise.resolve(Arguments.createMap().apply {
            putBoolean("initialized", true)
            putString("outcome", "success")
            putString("mode", sceneMode)
        })
    }

    @ReactMethod
    fun isRokidAppInstalled(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        promise.resolve(AuthorizationHelper.INSTANCE.isRequiredRokidAppInstalled(activity))
    }

    @ReactMethod
    fun authenticate(scopes: ReadableArray?, appName: String?, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("ROKID_ACTIVITY_MISSING", "Current Activity is not available")
            return
        }
        if (!AuthorizationHelper.INSTANCE.isRequiredRokidAppInstalled(activity)) {
            promise.reject("ROKID_APP_MISSING", "Rokid AI App is not installed")
            return
        }
        authPromise?.reject("ROKID_AUTH_IN_PROGRESS", "Another Rokid authorization request is pending")
        authPromise = promise
        AuthorizationHelper.INSTANCE.requestAuthorization(activity, AUTH_REQUEST_CODE)
    }

    @ReactMethod
    fun getAuthState(promise: Promise) {
        promise.resolve(authStatePayload())
    }

    @ReactMethod
    fun clearAuthentication(promise: Promise) {
        authToken = null
        promise.resolve(null)
    }

    @ReactMethod
    fun queryCustomApp(promise: Promise) {
        val token = authToken
        if (token.isNullOrBlank()) {
            promise.reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before querying CustomApp")
            return
        }
        sceneMode = "customApp"
        pendingQueryAppPromise = promise
        ensureLink("customApp", token)
        tryRunPendingSceneAction()
    }

    @ReactMethod
    fun openCustomApp(activityName: String?, url: String?, promise: Promise) {
        val token = authToken
        if (token.isNullOrBlank()) {
            promise.reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before opening CustomApp")
            return
        }
        sceneMode = "customApp"
        pendingCustomAppActivity = if (activityName.isNullOrBlank()) DEFAULT_APP_ACTIVITY else activityName
        pendingCustomAppUrl = url ?: ""
        pendingCustomAppPromise = promise
        ensureLink("customApp", token)
        tryRunPendingSceneAction()
    }

    @ReactMethod
    fun stopCustomApp(promise: Promise) {
        cxrLink?.appStop(appCallback)
        isCustomAppOpened = false
        promise.resolve(Arguments.createMap().apply {
            putBoolean("success", true)
        })
    }

    @ReactMethod
    fun openCustomView(viewJson: String?, promise: Promise) {
        val token = authToken
        if (token.isNullOrBlank()) {
            promise.reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before opening CustomView")
            return
        }
        sceneMode = "customView"
        pendingCustomViewJson = if (viewJson.isNullOrBlank()) defaultCustomViewJson() else viewJson
        pendingCustomViewPromise = promise
        ensureLink("customView", token)
        tryRunPendingSceneAction()
    }

    @ReactMethod
    fun closeCustomView(viewJson: String?, promise: Promise) {
        cxrLink?.customViewClose()
        isCustomViewOpened = false
        promise.resolve(Arguments.createMap().apply {
            putBoolean("success", true)
        })
    }

    @ReactMethod
    fun startRecord(type: String?, promise: Promise) {
        if (!isSceneReady()) {
            promise.reject("ROKID_SCENE_REQUIRED", "Open CustomView or CustomApp before recording")
            return
        }
        val link = cxrLink
        if (link == null) {
            promise.reject("ROKID_LINK_MISSING", "Rokid CXR link is not ready")
            return
        }
        audioBuffer.reset()
        recordStartedAt = System.currentTimeMillis()
        isRecording = true
        link.setCXRAudioCbk(audioCallback)
        link.startAudioStream(1)
        promise.resolve(null)
    }

    @ReactMethod
    fun stopRecord(type: String?, promise: Promise) {
        cxrLink?.stopAudioStream()
        isRecording = false
        try {
            val payload = flushAudioSegment()
            promise.resolve(payload)
        } catch (e: Exception) {
            promise.reject("ROKID_AUDIO_SAVE_ERROR", "Failed to save Rokid audio", e)
        }
    }

    @ReactMethod
    fun takePhoto(width: Double, height: Double, quality: Double, promise: Promise) {
        if (!isSceneReady()) {
            promise.reject("ROKID_SCENE_REQUIRED", "Open CustomView or CustomApp before taking photos")
            return
        }
        val link = cxrLink
        if (link == null) {
            promise.reject("ROKID_LINK_MISSING", "Rokid CXR link is not ready")
            return
        }

        val oneShotCallback = object : IImageStreamCbk {
            override fun onImageReceived(data: ByteArray?) {
                if (data == null || data.isEmpty()) {
                    promise.reject("ROKID_PHOTO_ERROR", "Photo callback returned empty data")
                    return
                }
                try {
                    val payload = savePhoto(data)
                    emit("onRokidPhotoReady", payload)
                    promise.resolve(payload)
                } catch (e: Exception) {
                    promise.reject("ROKID_PHOTO_ERROR", "Failed to save photo", e)
                } finally {
                    cxrLink?.setCXRImageCbk(imageCallback)
                }
            }

            override fun onImageError(code: Int, msg: String?) {
                promise.reject("ROKID_PHOTO_ERROR", "Photo error $code: ${msg ?: ""}")
                cxrLink?.setCXRImageCbk(imageCallback)
            }
        }

        link.setCXRImageCbk(oneShotCallback)
        link.takePhoto(width.toInt(), height.toInt(), quality.toInt())
    }

    @ReactMethod
    fun playAudioFile(filePath: String, promise: Promise) {
        try {
            val file = File(normalizedPath(filePath))
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                setOnCompletionListener {
                    it.release()
                    if (mediaPlayer === it) {
                        mediaPlayer = null
                    }
                }
                prepare()
                start()
            }
            promise.resolve(Arguments.createMap().apply {
                putString("filePath", file.absolutePath)
                putDouble("duration", (mediaPlayer?.duration ?: 0).toDouble() / 1000.0)
            })
        } catch (e: Exception) {
            promise.reject("ROKID_AUDIO_PLAYBACK_ERROR", "Failed to play Rokid audio", e)
        }
    }

    @ReactMethod
    fun stopAudioPlayback(promise: Promise) {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        promise.resolve(null)
    }

    @ReactMethod
    fun getAudioWaveform(filePath: String, bars: Double, promise: Promise) {
        try {
            val values = waveformValues(normalizedPath(filePath), max(bars.toInt(), 8))
            val array = Arguments.createArray()
            values.forEach { array.pushDouble(it) }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("ROKID_WAVEFORM_ERROR", "Failed to parse Rokid audio waveform", e)
        }
    }

    @ReactMethod
    fun resolveMediaPath(filePath: String, promise: Promise) {
        promise.resolve(resolveExistingMediaPath(filePath) ?: "")
    }

    @ReactMethod
    fun getSavedMedia(promise: Promise) {
        try {
            promise.resolve(Arguments.createMap().apply {
                putArray("recordings", listSavedMedia("rokid-audio", setOf("wav"), true))
                putArray("photos", listSavedMedia("rokid-photos", setOf("jpg", "jpeg"), false))
            })
        } catch (e: Exception) {
            promise.reject("ROKID_MEDIA_LIST_ERROR", "Failed to list saved Rokid media", e)
        }
    }

    private fun handleAuthorizationResult(resultCode: Int, data: Intent?) {
        val promise = authPromise ?: return
        authPromise = null
        val result = AuthorizationHelper.INSTANCE.parseAuthorizationResult(resultCode, data)
        when (result) {
            is AuthResult.AuthSuccess -> {
                authToken = result.token
                val payload = Arguments.createMap().apply {
                    putString("token", result.token)
                    putString("sessionId", null)
                }
                emit("onRokidAuthEvent", Arguments.createMap().apply {
                    putString("event", "authenticationSucceeded")
                    putString("token", result.token)
                })
                emit("onRokidAuthStateChanged", authStatePayload())
                promise.resolve(payload)
            }
            is AuthResult.AuthFail -> {
                authToken = null
                emit("onRokidAuthStateChanged", authStatePayload())
                promise.reject("ROKID_AUTH_ERROR", "Rokid authorization failed")
            }
            else -> {
                authToken = null
                emit("onRokidAuthStateChanged", authStatePayload())
                promise.reject("ROKID_AUTH_CANCELLED", "Rokid authorization was cancelled")
            }
        }
    }

    private fun ensureLink(mode: String, token: String) {
        val sessionType = if (mode == "customView") {
            CxrDefs.CXRSessionType.CUSTOMVIEW
        } else {
            CxrDefs.CXRSessionType.CUSTOMAPP
        }

        cxrLink = CXRLink(reactContext).apply {
            if (mode == "customView") {
                configCXRSession(CxrDefs.CXRSession(sessionType))
                setCXRCustomViewCbk(customViewCallback)
            } else {
                configCXRSession(CxrDefs.CXRSession(sessionType, "com.rokid.cxrswithcxrl"))
            }
            setCXRLinkCbk(linkCallback)
            setCXRAudioCbk(audioCallback)
            setCXRImageCbk(imageCallback)
        }
        isCxrConnected = false
        isGlassBtConnected = false
        cxrLink?.connect(token)
    }

    private fun tryRunPendingSceneAction() {
        val link = cxrLink ?: return
        if (!isCxrConnected || !isGlassBtConnected) {
            return
        }
        pendingQueryAppPromise?.let {
            if (!invokeAppQuery(link)) {
                it.resolve(Arguments.createMap().apply {
                    putBoolean("installed", false)
                    putString("packageName", "com.rokid.cxrswithcxrl")
                })
                pendingQueryAppPromise = null
            }
        }
        pendingCustomViewJson?.let { view ->
            pendingCustomViewJson = null
            invokeCustomViewIcons(link)
            link.customViewOpen(view)
        }
        pendingCustomAppActivity?.let { activity ->
            pendingCustomAppActivity = null
            link.appStart(activity, appCallback)
        }
    }

    private fun invokeAppQuery(link: CXRLink): Boolean {
        return runCatching {
            val method = link.javaClass.methods.firstOrNull { method ->
                method.name in listOf("appIsInstalled", "queryApp") && method.parameterTypes.size == 1
            } ?: return false
            method.invoke(link, appCallback)
            true
        }.getOrDefault(false)
    }

    private fun invokeCustomViewIcons(link: CXRLink) {
        runCatching {
            val method = link.javaClass.methods.firstOrNull { candidate ->
                candidate.name in listOf("customViewSetIcons", "customViewSendIcons") && candidate.parameterTypes.size == 1
            } ?: return
            method.invoke(link, "[]")
        }
    }

    private fun isSceneReady(): Boolean {
        return isCustomViewOpened || isCustomAppOpened
    }

    private fun flushAudioSegment(): WritableMap {
        val pcm = audioBuffer.toByteArray()
        audioBuffer.reset()
        if (pcm.isEmpty()) {
            return Arguments.createMap().apply {
                putString("filePath", "")
                putDouble("duration", 0.0)
                putDouble("timestamp", recordStartedAt.toDouble())
                putInt("size", 0)
            }
        }
        val file = saveWav(pcm)
        val payload = Arguments.createMap().apply {
            putString("filePath", file.absolutePath)
            putDouble("duration", ((System.currentTimeMillis() - recordStartedAt).coerceAtLeast(0)).toDouble() / 1000.0)
            putDouble("timestamp", recordStartedAt.toDouble())
            putInt("size", pcm.size)
        }
        emit("onRokidAudioSegmentReady", payload)
        return payload
    }

    private fun saveWav(pcmData: ByteArray): File {
        val dir = persistentMediaDir("rokid-audio")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        val fileName = "rokid_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date()) + ".wav"
        val file = File(dir, fileName)
        file.writeBytes(createWavData(pcmData, 16000))
        return file
    }

    private fun createWavData(pcmData: ByteArray, sampleRate: Int): ByteArray {
        val channels: Short = 1
        val bitsPerSample: Short = 16
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign: Short = (channels * bitsPerSample / 8).toShort()
        val dataSize = pcmData.size
        val fileSize = dataSize + 36

        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray())
        header.putInt(fileSize)
        header.put("WAVE".toByteArray())
        header.put("fmt ".toByteArray())
        header.putInt(16)
        header.putShort(1)
        header.putShort(channels)
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(blockAlign)
        header.putShort(bitsPerSample)
        header.put("data".toByteArray())
        header.putInt(dataSize)
        return header.array() + pcmData
    }

    private fun normalizedPath(filePath: String): String {
        return filePath.removePrefix("file://")
    }

    private fun persistentMediaDir(folder: String): File {
        return File(reactContext.filesDir, "ringmemoryapp/$folder")
    }

    private fun legacyMediaDirs(folder: String): List<File> {
        return listOfNotNull(
            reactContext.getExternalFilesDir(Environment.DIRECTORY_MUSIC),
            reactContext.getExternalFilesDir(Environment.DIRECTORY_PICTURES),
            reactContext.filesDir,
        ).map { File(it, folder) }
    }

    private fun resolveExistingMediaPath(filePath: String): String? {
        val normalized = normalizedPath(filePath)
        val direct = File(normalized)
        if (direct.exists()) {
            return direct.absolutePath
        }

        val fileName = direct.name.takeIf { it.isNotBlank() } ?: return null
        for (folder in listOf("rokid-audio", "rokid-photos")) {
            val candidates = listOf(persistentMediaDir(folder)) + legacyMediaDirs(folder)
            for (dir in candidates) {
                val candidate = File(dir, fileName)
                if (candidate.exists()) {
                    return candidate.absolutePath
                }
            }
        }
        return null
    }

    private fun listSavedMedia(folder: String, extensions: Set<String>, isAudio: Boolean): WritableArray {
        val seenFileNames = mutableSetOf<String>()
        val files = (listOf(persistentMediaDir(folder)) + legacyMediaDirs(folder))
            .flatMap { dir ->
                dir.listFiles { file -> file.isFile && extensions.contains(file.extension.lowercase()) }
                    ?.toList()
                    ?: emptyList()
            }
            .filter { seenFileNames.add(it.name) }
            .sortedByDescending { it.lastModified() }

        return Arguments.createArray().apply {
            files.forEach { file ->
                pushMap(Arguments.createMap().apply {
                    putString("filePath", file.absolutePath)
                    putDouble("timestamp", file.lastModified().toDouble())
                    putInt("size", file.length().toInt())
                    if (isAudio) {
                        putDouble("duration", max(file.length() - 44, 0).toDouble() / 32000.0)
                    }
                })
            }
        }
    }

    private fun waveformValues(filePath: String, bars: Int): List<Double> {
        val bytes = File(filePath).readBytes()
        val dataOffset = findWavDataOffset(bytes) ?: min(44, bytes.size)
        val dataSize = bytes.size - dataOffset
        if (dataSize < 2) {
            return List(bars) { 0.0 }
        }

        val sampleCount = dataSize / 2
        val samplesPerBar = max(sampleCount / bars, 1)
        return List(bars) { barIndex ->
            val startSample = barIndex * samplesPerBar
            val endSample = min(startSample + samplesPerBar, sampleCount)
            if (startSample >= endSample) {
                0.0
            } else {
                var peak = 0
                for (sampleIndex in startSample until endSample) {
                    val offset = dataOffset + sampleIndex * 2
                    val sample = ((bytes[offset + 1].toInt() shl 8) or (bytes[offset].toInt() and 0xff)).toShort().toInt()
                    peak = max(peak, abs(sample))
                }
                min(peak.toDouble() / 32768.0, 1.0)
            }
        }
    }

    private fun findWavDataOffset(bytes: ByteArray): Int? {
        if (bytes.size <= 44) {
            return null
        }
        var index = 12
        while (index + 8 <= bytes.size) {
            val id = String(bytes, index, 4)
            val size = ByteBuffer.wrap(bytes, index + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
            val start = index + 8
            if (id == "data" && start < bytes.size) {
                return start
            }
            index = start + max(size, 0) + (size and 1)
        }
        return null
    }

    private fun savePhoto(data: ByteArray): WritableMap {
        val dir = persistentMediaDir("rokid-photos")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        val fileName = "rokid_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date()) + ".jpg"
        val file = File(dir, fileName)
        FileOutputStream(file).use { it.write(data) }
        return Arguments.createMap().apply {
            putString("filePath", file.absolutePath)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
            putInt("size", data.size)
        }
    }

    private fun authStatePayload(): WritableMap {
        return Arguments.createMap().apply {
            if (authToken.isNullOrBlank()) {
                putString("status", "notAuthenticated")
                putBoolean("isAuthenticated", false)
            } else {
                putString("status", "authenticated")
                putBoolean("isAuthenticated", true)
                putString("token", authToken)
            }
        }
    }

    private fun defaultCustomViewJson(): String {
        return """
            {
              "type":"LinearLayout",
              "props":{
                "layout_width":"match_parent",
                "layout_height":"match_parent",
                "orientation":"vertical",
                "gravity":"center",
                "paddingTop":"140dp",
                "paddingBottom":"100dp",
                "paddingStart":"24dp",
                "paddingEnd":"24dp",
                "backgroundColor":"#FF000000"
              },
              "children":[
                {
                  "type":"TextView",
                  "props":{
                    "id":"title",
                    "layout_width":"wrap_content",
                    "layout_height":"wrap_content",
                    "text":"SeeMemory Ready",
                    "textColor":"#FF00FF00",
                    "textSize":"20sp",
                    "textStyle":"bold"
                  }
                }
              ]
            }
        """.trimIndent()
    }

    private fun emit(event: String, payload: Any?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    private fun emitError(message: String) {
        Log.e(TAG, message)
        emit("onRokidError", message)
    }
}
