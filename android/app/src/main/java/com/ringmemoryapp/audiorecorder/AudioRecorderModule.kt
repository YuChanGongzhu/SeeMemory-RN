package com.ringmemoryapp.audiorecorder

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * 手机麦克风录音（通用，与具体硬件设备无关）：MediaRecorder 录成 m4a/AAC，
 * 供「记忆对话」语音输入等场景使用。同一时刻只维护一路录音。
 *
 * 运行时权限：JS 侧用 PermissionsAndroid 申请 RECORD_AUDIO；这里 startRecording 前再兜底校验一次。
 */
class AudioRecorderModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "RTNAudioRecorderModule"
    }

    private var recorder: MediaRecorder? = null
    private var currentPath: String? = null
    private var startedAtMs: Long = 0

    override fun getName(): String = NAME

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    /** 是否已授予麦克风权限（申请交给 JS 的 PermissionsAndroid）。 */
    @ReactMethod
    fun requestPermission(promise: Promise) {
        promise.resolve(hasPermission())
    }

    @ReactMethod
    fun startRecording(promise: Promise) {
        if (!hasPermission()) {
            promise.reject("AUDIO_RECORD_ERROR", "Microphone permission not granted")
            return
        }
        try {
            releaseRecorder()
            // 存到 filesDir/voice（持久目录），保证语音消息重开 App 后仍能本地回听。
            val dir = File(reactContext.filesDir, "voice").apply { mkdirs() }
            val outFile = File(dir, "voice-${System.currentTimeMillis()}.m4a")
            @Suppress("DEPRECATION")
            val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(reactContext)
            } else {
                MediaRecorder()
            }
            rec.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(16000)
                setAudioChannels(1)
                setOutputFile(outFile.absolutePath)
                prepare()
                start()
            }
            recorder = rec
            currentPath = outFile.absolutePath
            startedAtMs = System.currentTimeMillis()
            promise.resolve(null)
        } catch (e: Exception) {
            releaseRecorder()
            promise.reject("AUDIO_RECORD_ERROR", "Failed to start recording: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        val path = currentPath
        if (recorder == null || path == null) {
            promise.reject("AUDIO_RECORD_ERROR", "No active recording")
            return
        }
        val durationMs = (System.currentTimeMillis() - startedAtMs).toInt()
        try {
            recorder?.stop()
        } catch (e: Exception) {
            // stop 太快（无有效音频）会抛异常：清理并报错。
            releaseRecorder()
            File(path).delete()
            promise.reject("AUDIO_RECORD_ERROR", "Recording too short or failed: ${e.message}", e)
            return
        }
        releaseRecorder()
        val payload = Arguments.createMap().apply {
            putString("filePath", path)
            putInt("durationMs", durationMs)
        }
        promise.resolve(payload)
    }

    @ReactMethod
    fun cancelRecording(promise: Promise) {
        val path = currentPath
        try {
            recorder?.stop()
        } catch (_: Exception) {
            // 忽略：取消时不关心 stop 是否成功。
        }
        releaseRecorder()
        if (path != null) {
            File(path).delete()
        }
        promise.resolve(null)
    }

    private fun releaseRecorder() {
        try {
            recorder?.reset()
            recorder?.release()
        } catch (_: Exception) {
            // ignore
        }
        recorder = null
        currentPath = null
    }
}
