package com.ringmemoryapp.rtnringmodule

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.fbreact.specs.NativeRingModuleSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.lm.sdk.AdPcmTool
import com.lm.sdk.BLEService
import com.lm.sdk.LmAPI
import com.lm.sdk.LogicalApi
import com.lm.sdk.inter.IResponseListener
import com.lm.sdk.mode.SystemControlBean
import com.lm.sdk.utils.BLEUtils
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

class RingModule(reactContext: ReactApplicationContext) : NativeRingModuleSpec(reactContext), IResponseListener {

    companion object {
        const val NAME = "RTNRingModule"
        private const val TAG = "RingModule"
        private const val EVENT_DEVICE_FOUND = "onDeviceFound"
        private const val EVENT_DEVICE_CONNECTED = "onDeviceConnected"
        private const val EVENT_DEVICE_DISCONNECTED = "onDeviceDisconnected"
        private const val EVENT_BATTERY_CHANGED = "onBatteryChanged"
        private const val EVENT_AUDIO_SEGMENT_READY = "onAudioSegmentReady"
        private const val EVENT_ERROR = "onError"

        private const val SEGMENT_DURATION_MS = 60_000L
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private var isScanning = false
    private var isCapturingAudio = false
    private var captureStartTimeMs: Long = 0L
    private var connectedMac: String? = null
    private var mediaPlayer: MediaPlayer? = null

    private var connectPromise: Promise? = null
    private val discoveredDevices = ConcurrentHashMap<String, WritableMap>()

    private val adpcmPackets = mutableListOf<ByteArray>()

    init {
        LmAPI.clearWLSCmdListener()
        LmAPI.addWLSCmdListener(reactApplicationContext, this)
    }

    private fun sendEvent(event: String, payload: Any?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    private fun emitError(message: String, throwable: Throwable? = null) {
        Log.e(TAG, message, throwable)
        sendEvent(EVENT_ERROR, message)
    }

    @SuppressLint("MissingPermission")
    override fun startScan(promise: Promise) {
        if (isScanning) {
            promise.reject("SCAN_ERROR", "Already scanning")
            return
        }

        isScanning = true
        discoveredDevices.clear()

        BLEUtils.stopLeScan(reactApplicationContext, leScanCallback)
        BLEUtils.startLeScan(reactApplicationContext, leScanCallback)

        // Demo behavior: scan 5s then auto-stop.
        mainHandler.postDelayed({
            stopScanInternal()
        }, 5_000)

        promise.resolve(null)
    }

    @SuppressLint("MissingPermission")
    override fun stopScan(promise: Promise) {
        stopScanInternal()
        promise.resolve(null)
    }

    @SuppressLint("MissingPermission")
    private fun stopScanInternal() {
        BLEUtils.stopLeScan(reactApplicationContext, leScanCallback)
        isScanning = false
    }

    @SuppressLint("MissingPermission")
    private val leScanCallback = BluetoothAdapter.LeScanCallback { device, rssi, scanRecord ->
        if (device == null || device.address.isNullOrEmpty()) {
            return@LeScanCallback
        }

        val deviceInfo = LogicalApi.getBleDeviceInfoWhenBleScan(device, rssi, scanRecord, false)
        if (deviceInfo == null) {
            return@LeScanCallback
        }

        val map = Arguments.createMap().apply {
            putString("id", device.address)
            putString("name", device.name ?: "Smart Ring")
            putInt("rssi", rssi)
            putBoolean("isConnected", false)
            putInt("batteryLevel", 100)
            putString("macAddress", device.address)
        }

        discoveredDevices[device.address] = map
        val devicesArray = Arguments.createArray()
        discoveredDevices.values.forEach { devicesArray.pushMap(it) }

        val payload = Arguments.createMap().apply {
            putArray("devices", devicesArray)
        }
        sendEvent(EVENT_DEVICE_FOUND, payload)
    }

    @SuppressLint("MissingPermission")
    override fun connectDevice(deviceId: String, promise: Promise) {
        val manager = reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = manager.adapter

        if (adapter == null) {
            promise.reject("CONNECT_ERROR", "Bluetooth not available")
            return
        }

        val remote: BluetoothDevice = try {
            adapter.getRemoteDevice(deviceId)
        } catch (e: Exception) {
            promise.reject("CONNECT_ERROR", "Invalid device address: $deviceId")
            return
        }

        connectPromise = promise
        connectedMac = deviceId
        BLEUtils.connectLockByBLE(reactApplicationContext, remote)

        // Fallback poll for SDK token state in case listener callback is delayed.
        waitForConnected(remote, retries = 25)
    }

    @SuppressLint("MissingPermission")
    private fun waitForConnected(device: BluetoothDevice, retries: Int) {
        if (BLEUtils.isGetToken() || BLEService.isGetToken()) {
            onConnected(device)
            return
        }

        if (retries <= 0) {
            connectPromise?.reject("CONNECT_ERROR", "Bluetooth connection timeout")
            connectPromise = null
            return
        }

        mainHandler.postDelayed({ waitForConnected(device, retries - 1) }, 400)
    }

    @SuppressLint("MissingPermission")
    private fun onConnected(device: BluetoothDevice) {
        val payload = Arguments.createMap().apply {
            putString("id", device.address)
            putString("name", device.name ?: "Smart Ring")
            putInt("batteryLevel", 100)
            putString("macAddress", device.address)
            putBoolean("isConnected", true)
        }

        // Ask ring to enter app connection state.
        try {
            LmAPI.APP_CONNECT()
        } catch (e: Exception) {
            Log.w(TAG, "APP_CONNECT call failed", e)
        }

        sendEvent(EVENT_DEVICE_CONNECTED, payload)
        connectPromise?.resolve(true)
        connectPromise = null
    }

    @SuppressLint("MissingPermission")
    override fun disconnectDevice(promise: Promise) {
        isCapturingAudio = false
        connectedMac = null
        BLEUtils.disconnectBLE(reactApplicationContext)
        sendEvent(EVENT_DEVICE_DISCONNECTED, Arguments.createMap())
        promise.resolve(null)
    }

    override fun getDeviceStatus(promise: Promise) {
        val status = when {
            BLEUtils.isGetToken() || BLEService.isGetToken() -> "connected"
            isScanning -> "scanning"
            else -> "disconnected"
        }
        promise.resolve(status)
    }

    override fun startCapture(promise: Promise) {
        if (isCapturingAudio) {
            promise.reject("CAPTURE_ERROR", "Already capturing")
            return
        }
        if (!(BLEUtils.isGetToken() || BLEService.isGetToken())) {
            promise.reject("CAPTURE_ERROR", "Device not connected")
            return
        }

        adpcmPackets.clear()
        captureStartTimeMs = System.currentTimeMillis()
        isCapturingAudio = true

        try {
            LmAPI.CONTROL_AUDIO_ADPCM_AUDIO(0x01)
            LmAPI.SET_AUDIO(0x01)
            promise.resolve(null)
        } catch (e: Exception) {
            isCapturingAudio = false
            promise.reject("CAPTURE_ERROR", "Failed to start audio capture", e)
        }
    }

    override fun stopCapture(promise: Promise) {
        isCapturingAudio = false
        try {
            LmAPI.SET_AUDIO(0x00)
        } catch (e: Exception) {
            Log.w(TAG, "SET_AUDIO stop failed", e)
        }

        flushAudioSegment()
        promise.resolve(null)
    }

    override fun isCapturing(promise: Promise) {
        promise.resolve(isCapturingAudio)
    }

    override fun getSavedAudioSegments(promise: Promise) {
        try {
            val audioDir = File(reactApplicationContext.filesDir, "ringmemoryapp/audio")
            if (!audioDir.exists()) {
                promise.resolve(Arguments.createArray())
                return
            }

            val files = audioDir.listFiles { file -> file.extension.lowercase() == "wav" }
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()

            val array = Arguments.createArray()
            files.forEach { file ->
                val size = file.length().toInt()
                val payload = Arguments.createMap().apply {
                    putString("filePath", file.absolutePath)
                    putDouble("duration", maxOf(size - 44, 0).toDouble() / 16000.0)
                    putDouble("timestamp", file.lastModified().toDouble())
                    putInt("size", size)
                }
                array.pushMap(payload)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("AUDIO_LIST_ERROR", "Failed to list saved audio", e)
        }
    }

    override fun playAudioFile(filePath: String, promise: Promise) {
        try {
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

    override fun stopAudioPlayback(promise: Promise) {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        promise.resolve(null)
    }

    override fun checkForFirmwareUpdate(promise: Promise) {
        promise.resolve(null)
    }

    override fun updateFirmware(filePath: String, promise: Promise) {
        promise.reject("FIRMWARE_ERROR", "Firmware update not implemented")
    }

    private fun onAudioPacket(packet: ByteArray) {
        if (!isCapturingAudio || packet.isEmpty()) {
            return
        }

        adpcmPackets.add(packet)

        if (System.currentTimeMillis() - captureStartTimeMs >= SEGMENT_DURATION_MS) {
            flushAudioSegment()
            captureStartTimeMs = System.currentTimeMillis()
        }
    }

    private fun flushAudioSegment() {
        if (adpcmPackets.isEmpty()) {
            return
        }

        try {
            val combined = ByteArrayOutputStream().apply {
                adpcmPackets.forEach { write(it) }
            }.toByteArray()

            val pcm = AdPcmTool().adpcmToPcmFromJNI(combined)
            val wavPath = saveWavFile(pcm)
            val payload = Arguments.createMap().apply {
                putString("filePath", wavPath)
                putDouble("duration", (System.currentTimeMillis() - captureStartTimeMs) / 1000.0)
                putDouble("timestamp", captureStartTimeMs.toDouble())
                putInt("size", pcm.size)
            }
            sendEvent(EVENT_AUDIO_SEGMENT_READY, payload)
        } catch (e: Exception) {
            emitError("Audio processing failed: ${e.message}", e)
        } finally {
            adpcmPackets.clear()
        }
    }

    private fun saveWavFile(pcmData: ByteArray): String {
        val audioDir = File(reactApplicationContext.filesDir, "ringmemoryapp/audio")
        if (!audioDir.exists()) {
            audioDir.mkdirs()
        }

        val fileName = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date()) + ".wav"
        val file = File(audioDir, fileName)
        file.writeBytes(createWavData(pcmData))
        return file.absolutePath
    }

    private fun createWavData(pcmData: ByteArray): ByteArray {
        val sampleRate = 8000
        val channels: Short = 1
        val bitsPerSample: Short = 16
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign: Short = (channels * bitsPerSample / 8).toShort()
        val dataSize = pcmData.size
        val fileSize = dataSize + 36

        val header = ByteBuffer.allocate(44)
        header.order(ByteOrder.LITTLE_ENDIAN)
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

    override fun addListener(eventName: String) {
        // Required by RN EventEmitter.
    }

    override fun removeListeners(count: Double) {
        // Required by RN EventEmitter.
    }

    // ===== IResponseListener =====

    override fun lmBleConnecting(code: Int) {
        Log.i(TAG, "BLE connecting: $code")
    }

    override fun lmBleConnectionSucceeded(code: Int) {
        Log.i(TAG, "BLE connected: $code")
    }

    override fun lmBleConnectionFailed(code: Int) {
        emitError("BLE connection failed: $code")
        connectPromise?.reject("CONNECT_ERROR", "BLE connection failed: $code")
        connectPromise = null
    }

    override fun VERSION(type: Byte, version: String?) {}
    override fun syncTime(datum: Byte, time: ByteArray?) {}
    override fun stepCount(data: ByteArray?) {}
    override fun clearStepCount(data: Byte) {}

    override fun battery(type: Byte, battery: Byte) {
        sendEvent(EVENT_BATTERY_CHANGED, battery.toInt())
    }

    override fun battery_push(type: Byte, battery: Byte) {
        sendEvent(EVENT_BATTERY_CHANGED, battery.toInt())
    }

    override fun timeOut() {
        emitError("SDK command timeout")
    }

    override fun saveData(data: String?) {}
    override fun reset(data: ByteArray?) {}
    override fun setCollection(data: Byte) {}
    override fun getCollection(data: ByteArray?) {}
    override fun getSerialNum(data: ByteArray?) {}
    override fun setSerialNum(data: Byte) {}
    override fun cleanHistory(data: Byte) {}
    override fun setBlueToolName(data: Byte) {}
    override fun readBlueToolName(type: Byte, name: String?) {}
    override fun stopRealTimeBP(data: Byte) {}
    override fun BPwaveformData(seq: Byte, number: Byte, waveDate: String?) {}
    override fun onSport(type: Int, data: ByteArray?) {}
    override fun breathLight(time: Byte) {}
    override fun SET_HID(result: Byte) {}
    override fun GET_HID(touch: Byte, gesture: Byte, system: Byte) {}
    override fun GET_HID_CODE(bytes: ByteArray?) {}
    override fun GET_CONTROL_AUDIO_ADPCM(pcmType: Byte) {}
    override fun SET_AUDIO_ADPCM_AUDIO(result: Byte) {}
    override fun TOUCH_AUDIO_FINISH_XUN_FEI() {}

    override fun setAudio(totalLength: Short, index: Int, audioData: ByteArray?) {
        if (audioData != null) {
            onAudioPacket(audioData)
        }
    }

    override fun stopHeart(data: Byte) {}
    override fun stopQ2(data: Byte) {}
    override fun GET_ECG(bytes: ByteArray?) {}
    override fun SystemControl(systemControlBean: SystemControlBean?) {}

    override fun CONTROL_AUDIO(bytes: ByteArray?) {
        if (bytes != null) {
            onAudioPacket(bytes)
        }
    }

    override fun motionCalibration(sport_count: Byte) {}
    override fun stopBloodPressure(data: Byte) {}

    override fun appBind(systemControlBean: SystemControlBean?) {}

    override fun appConnect(systemControlBean: SystemControlBean?) {
        val mac = connectedMac
        if (mac != null && (BLEUtils.isGetToken() || BLEService.isGetToken())) {
            val manager = reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = manager.adapter
            val remote = try {
                adapter?.getRemoteDevice(mac)
            } catch (_: Exception) {
                null
            }
            if (remote != null) {
                onConnected(remote)
            }
        }
    }

    override fun appRefresh(systemControlBean: SystemControlBean?) {}
}
