package com.ringmemoryapp.audioplayer

import android.media.MediaPlayer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * 通用本地/远程音频播放（MediaPlayer）。与具体硬件设备无关，供 MR20、Rokid 等
 * 任何需要试听录音的地方复用。
 */
class AudioPlayerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "RTNAudioPlayerModule"
    }

    private var mediaPlayer: MediaPlayer? = null

    override fun getName(): String = NAME

    @ReactMethod
    fun playAudioFile(filePath: String, promise: Promise) {
        try {
            if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
                mediaPlayer?.release()
                var settled = false
                mediaPlayer = MediaPlayer().apply {
                    setDataSource(filePath)
                    setOnPreparedListener {
                        it.start()
                        if (!settled) {
                            settled = true
                            promise.resolve(Arguments.createMap().apply {
                                putDouble("duration", it.duration.toDouble() / 1000.0)
                            })
                        }
                    }
                    setOnErrorListener { mp, what, extra ->
                        if (!settled) {
                            settled = true
                            promise.reject("AUDIO_PLAYBACK_ERROR", "Streaming failed ($what/$extra)")
                        }
                        mp.release()
                        if (mediaPlayer === mp) mediaPlayer = null
                        true
                    }
                    setOnCompletionListener {
                        it.release()
                        if (mediaPlayer === it) mediaPlayer = null
                    }
                    prepareAsync()
                }
                return
            }

            val file = File(filePath)
            if (!file.exists()) {
                promise.reject("AUDIO_PLAYBACK_ERROR", "Audio file not found")
                return
            }

            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                prepare()
                start()
            }

            val payload = Arguments.createMap().apply {
                putDouble("duration", (mediaPlayer?.duration ?: 0).toDouble() / 1000.0)
            }
            promise.resolve(payload)
        } catch (e: Exception) {
            promise.reject("AUDIO_PLAYBACK_ERROR", "Failed to play audio", e)
        }
    }

    @ReactMethod
    fun stopAudioPlayback(promise: Promise) {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        promise.resolve(null)
    }
}
