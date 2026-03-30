import Foundation
import CoreBluetooth
import AVFoundation
import React
import BCLRingSDK

@objc(RTNRingModule)
class RTNRingModule: RCTEventEmitter {
    private enum CaptureAudioFormat {
        case adpcm
        case pcm
    }

    private var hasListeners = false
    private var isScanning = false
    private var isCapturingAudio = false
    private var captureStartTime: TimeInterval = 0
    private var bufferedAudioPackets: [(seq: Int, data: Data)] = []
    private var connectedDeviceId: String?
    private var captureSessionID = 0
    private var pendingCaptureRetry: DispatchWorkItem?
    private var audioPlayer: AVAudioPlayer?
    private var currentCaptureFormat: CaptureAudioFormat = .adpcm

    private let segmentDurationSeconds: TimeInterval = 60

    override init() {
        super.init()
        BCLRingManager.shared.peripheralDelegate = self
    }

    @objc override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        [
            "onDeviceFound",
            "onDeviceConnected",
            "onDeviceDisconnected",
            "onBatteryChanged",
            "onAudioSegmentReady",
            "onError",
            "onDebugLog",
        ]
    }

    @objc(addListener:)
    override func addListener(_ eventName: String) {
        super.addListener(eventName)
    }

    @objc(removeListeners:)
    override func removeListeners(_ count: Double) {
        super.removeListeners(count)
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    @objc(startScan:reject:)
    func startScan(_ resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock) {
        guard !isScanning else {
            reject("SCAN_ERROR", "Already scanning", nil)
            return
        }

        isScanning = true
        var didSettlePromise = false
        emitDebugLog("开始扫描蓝牙设备")
        BCLRingManager.shared.startScan { [weak self] result in
            guard let self else { return }

            switch result {
            case let .success(devices):
                let payloadDevices: [[String: Any]] = devices.map { device in
                    let uuid = device.uuidString
                    let mac = device.macAddress ?? ""
                    return [
                        "id": mac.isEmpty ? uuid : mac,
                        "name": device.peripheralName ?? device.localName ?? "Smart Ring",
                        "rssi": device.rssi?.intValue ?? 0,
                        "isConnected": device.isScannedAndConnected,
                        "batteryLevel": 100,
                        "macAddress": mac,
                        "uuidString": uuid,
                    ]
                }
                if self.hasListeners {
                    self.sendEvent(withName: "onDeviceFound", body: ["devices": payloadDevices])
                }
                if !didSettlePromise {
                    didSettlePromise = true
                    resolve(nil)
                }
            case let .failure(error):
                self.isScanning = false
                self.emitDebugLog("扫描失败: \(error.localizedDescription)")
                if !didSettlePromise {
                    didSettlePromise = true
                    reject("SCAN_ERROR", error.localizedDescription, error)
                } else {
                    if self.hasListeners {
                        self.sendEvent(withName: "onError", body: "Scan failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    @objc(stopScan:reject:)
    func stopScan(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject _: @escaping RCTPromiseRejectBlock) {
        BCLRingManager.shared.stopScan()
        isScanning = false
        emitDebugLog("停止扫描蓝牙设备")
        resolve(nil)
    }

    @objc(connectDevice:resolve:reject:)
    func connectDevice(_ deviceId: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        var didSettlePromise = false
        let connectCompletion: (Result<BCLDeviceInfoModel, BCLError>) -> Void = { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(device):
                self.connectedDeviceId = deviceId
                let mac = device.macAddress ?? ""
                let resolvedID = mac.isEmpty ? device.uuidString : mac
                if self.hasListeners {
                    self.sendEvent(withName: "onDeviceConnected", body: [
                        "id": resolvedID,
                        "name": device.peripheralName ?? device.localName ?? "Smart Ring",
                        "batteryLevel": 100,
                        "macAddress": mac,
                        "uuidString": device.uuidString,
                        "isConnected": true,
                    ])
                }
                self.emitDebugLog("设备已连接: \(resolvedID)")
                if !didSettlePromise {
                    didSettlePromise = true
                    resolve(true)
                }
            case let .failure(error):
                self.emitDebugLog("连接失败: \(error.localizedDescription)")
                if !didSettlePromise {
                    didSettlePromise = true
                    reject("CONNECT_ERROR", error.localizedDescription, error)
                } else if self.hasListeners {
                    self.sendEvent(withName: "onError", body: "Connect failed: \(error.localizedDescription)")
                }
            }
        }

        if deviceId.contains(":") {
            BCLRingManager.shared.startConnect(
                macAddress: deviceId,
                isAutoReconnect: true,
                autoReconnectTimeLimit: 600,
                autoReconnectMaxAttempts: 20,
                connectResultBlock: connectCompletion
            )
        } else {
            BCLRingManager.shared.startConnect(
                uuidString: deviceId,
                isAutoReconnect: true,
                autoReconnectTimeLimit: 600,
                autoReconnectMaxAttempts: 20,
                connectResultBlock: connectCompletion
            )
        }
    }

    @objc(disconnectDevice:reject:)
    func disconnectDevice(_ resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
        BCLRingManager.shared.disconnect()
        isCapturingAudio = false
        captureSessionID += 1
        pendingCaptureRetry?.cancel()
        pendingCaptureRetry = nil
        connectedDeviceId = nil
        if hasListeners {
            sendEvent(withName: "onDeviceDisconnected", body: [:])
        }
        emitDebugLog("设备已断开连接")
        resolve(nil)
    }

    @objc(getDeviceStatus:reject:)
    func getDeviceStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                         reject _: @escaping RCTPromiseRejectBlock) {
        if BCLRingManager.shared.currentConnectedDevice != nil {
            resolve("connected")
        } else if isScanning {
            resolve("scanning")
        } else {
            resolve("disconnected")
        }
    }

    @objc(startCapture:reject:)
    func startCapture(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
        startCapture(format: .adpcm, resolve: resolve, reject: reject)
    }

    @objc(startCapturePCM:reject:)
    func startCapturePCM(_ resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock) {
        startCapture(format: .pcm, resolve: resolve, reject: reject)
    }

    private func startCapture(format: CaptureAudioFormat,
                              resolve: @escaping RCTPromiseResolveBlock,
                              reject: @escaping RCTPromiseRejectBlock) {
        guard !isCapturingAudio else {
            reject("CAPTURE_ERROR", "Already capturing", nil)
            return
        }
        let hasConnectedDevice = BCLRingManager.shared.currentConnectedDevice != nil || connectedDeviceId != nil
        guard hasConnectedDevice else {
            reject("CAPTURE_ERROR", "Device not connected. Please connect the ring first.", nil)
            return
        }

        isCapturingAudio = true
        captureSessionID += 1
        captureStartTime = Date().timeIntervalSince1970
        bufferedAudioPackets.removeAll()
        pendingCaptureRetry?.cancel()
        pendingCaptureRetry = nil
        currentCaptureFormat = format
        let sessionID = captureSessionID
        var didSettlePromise = false
        emitDebugLog("开始\(format == .pcm ? "PCM" : "ADPCM")录音")
        let audioType: BCLAudioType = format == .pcm ? .pcm : .adpcm
        BCLRingManager.shared.setActivePushAudioInfo(audioType: audioType) { [weak self] configResult in
            guard let self else { return }
            guard self.isCapturingAudio, sessionID == self.captureSessionID else { return }

            switch configResult {
            case .success:
                self.openCaptureStream(format: format, sessionID: sessionID) { appendResult in
                    switch appendResult {
                    case let .success(response):
                        if !didSettlePromise {
                            didSettlePromise = true
                            resolve(nil)
                        }
                        self.handleIncomingPacket(seq: response.seq, audioData: response.audioData)
                    case let .failure(error):
                        self.isCapturingAudio = false
                        self.emitDebugLog("录音启动失败: \(error.localizedDescription)")
                        if !didSettlePromise {
                            didSettlePromise = true
                            reject("CAPTURE_ERROR", error.localizedDescription, error)
                        } else if self.hasListeners {
                            self.sendEvent(withName: "onError", body: "Audio stream failed: \(error.localizedDescription)")
                        }
                    }
                }
            case let .failure(error):
                self.isCapturingAudio = false
                self.emitDebugLog("设置音频格式失败: \(error.localizedDescription)")
                reject("CAPTURE_ERROR", "Set active push audio format failed: \(error.localizedDescription)", error)
            }
        }
    }

    @objc(stopCapture:reject:)
    func stopCapture(_ resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
        isCapturingAudio = false
        captureSessionID += 1
        pendingCaptureRetry?.cancel()
        pendingCaptureRetry = nil
        var didSettlePromise = false
        let format = currentCaptureFormat
        emitDebugLog("停止\(format == .pcm ? "PCM" : "ADPCM")录音")
        let completion: (Result<Void, BCLError>) -> Void = { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.emitDebugLog("已停止\(format == .pcm ? "PCM" : "ADPCM")音频传输")
                self.flushCurrentAudioSegment()
                if !didSettlePromise {
                    didSettlePromise = true
                    resolve(nil)
                }
            case let .failure(error):
                self.emitDebugLog("停止录音失败: \(error.localizedDescription)")
                if !didSettlePromise {
                    didSettlePromise = true
                    reject("CAPTURE_ERROR", error.localizedDescription, error)
                }
            }
        }

        if format == .pcm {
            BCLRingManager.shared.controlPCMFormatAudio(isOpen: false) { result in
                switch result {
                case .success:
                    completion(.success(()))
                case let .failure(error):
                    completion(.failure(error))
                }
            }
        } else {
            BCLRingManager.shared.controlADPCMFormatAudio(isOpen: false) { result in
                switch result {
                case .success:
                    completion(.success(()))
                case let .failure(error):
                    completion(.failure(error))
                }
            }
        }
    }

    @objc(playAudioFile:resolve:reject:)
    func playAudioFile(_ filePath: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        let url = URL(fileURLWithPath: filePath)
        guard FileManager.default.fileExists(atPath: url.path) else {
            reject("AUDIO_PLAYBACK_ERROR", "Audio file not found", nil)
            return
        }

        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            let fileSize = (attributes[.size] as? NSNumber)?.intValue ?? 0

            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default)
            try audioSession.setActive(true, options: [])

            audioPlayer?.stop()
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.prepareToPlay()
            let didStart = audioPlayer?.play() ?? false
            emitDebugLog("开始播放录音: \(url.lastPathComponent), size=\(fileSize)B, duration=\(audioPlayer?.duration ?? 0)s, started=\(didStart)")
            guard didStart else {
                reject("AUDIO_PLAYBACK_ERROR", "Audio player failed to start", nil)
                return
            }
            resolve([
                "duration": audioPlayer?.duration ?? 0,
                "size": fileSize,
                "started": didStart,
            ])
        } catch {
            reject("AUDIO_PLAYBACK_ERROR", error.localizedDescription, error)
        }
    }

    @objc(stopAudioPlayback:reject:)
    func stopAudioPlayback(_ resolve: @escaping RCTPromiseResolveBlock,
                           reject _: @escaping RCTPromiseRejectBlock) {
        audioPlayer?.stop()
        audioPlayer = nil
        emitDebugLog("停止播放录音")
        resolve(nil)
    }

    @objc(isCapturing:reject:)
    func isCapturing(_ resolve: @escaping RCTPromiseResolveBlock,
                     reject _: @escaping RCTPromiseRejectBlock) {
        resolve(isCapturingAudio)
    }

    @objc(getSavedAudioSegments:reject:)
    func getSavedAudioSegments(_ resolve: @escaping RCTPromiseResolveBlock,
                               reject: @escaping RCTPromiseRejectBlock) {
        do {
            let dir = audioDirectory()
            guard FileManager.default.fileExists(atPath: dir.path) else {
                resolve([])
                return
            }

            let urls = try FileManager.default.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
            ).filter { $0.pathExtension.lowercased() == "wav" }

            let items: [[String: Any]] = try urls.map { url in
                let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                let size = values.fileSize ?? 0
                let duration = max(Double(max(size - 44, 0)) / 16000.0, 0)
                let modifiedAt = Int((values.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000)
                return [
                    "filePath": url.path,
                    "duration": duration,
                    "timestamp": modifiedAt,
                    "size": size,
                ]
            }.sorted { lhs, rhs in
                (lhs["timestamp"] as? Int ?? 0) > (rhs["timestamp"] as? Int ?? 0)
            }

            resolve(items)
        } catch {
            reject("AUDIO_LIST_ERROR", error.localizedDescription, error)
        }
    }

    @objc(checkForFirmwareUpdate:reject:)
    func checkForFirmwareUpdate(_ resolve: @escaping RCTPromiseResolveBlock,
                                reject _: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    @objc(updateFirmware:resolve:reject:)
    func updateFirmware(_: String,
                        resolve _: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
        reject("FIRMWARE_ERROR", "Firmware update not implemented", nil)
    }

    private func makeAudioPacketData(from audioData: [Int]) -> Data {
        let int16Values = audioData.map { Int16($0) }
        return int16Values.withUnsafeBufferPointer { buffer -> Data in
            guard let base = buffer.baseAddress else { return Data() }
            return Data(bytes: base, count: buffer.count * MemoryLayout<Int16>.size)
        }
    }

    private func flushCurrentAudioSegment() {
        guard !bufferedAudioPackets.isEmpty else { return }

        let sorted = bufferedAudioPackets.sorted { $0.seq < $1.seq }
        let pcmData = makePCMData(from: sorted)
        guard !pcmData.isEmpty else {
            bufferedAudioPackets.removeAll()
            return
        }

        let outputPath = saveAsWav(pcmData: pcmData)
        let duration = Double(pcmData.count) / 16000.0
        emitDebugLog("\(currentCaptureFormat == .pcm ? "PCM" : "ADPCM")录音片段已保存: \((outputPath as NSString).lastPathComponent)")
        if hasListeners {
            sendEvent(withName: "onAudioSegmentReady", body: [
                "filePath": outputPath,
                "duration": max(duration, 0),
                "timestamp": Int(captureStartTime * 1000),
                "size": pcmData.count,
            ])
        }

        bufferedAudioPackets.removeAll()
    }

    /// Align with SeeMemory processing: decode packet-by-packet to avoid noisy output caused by frame boundary/state issues.
    private func makePCMData(from packets: [(seq: Int, data: Data)]) -> Data {
        if currentCaptureFormat == .pcm {
            var processedPCMData = Data()
            for packet in packets {
                if let converted = BCLRingManager.shared.convertAdpcmToPcm(adpcmData: packet.data), !converted.isEmpty {
                    processedPCMData.append(converted)
                }
            }
            if processedPCMData.isEmpty, hasListeners {
                sendEvent(withName: "onError", body: "Failed to decode PCM stream packets")
            }
            return processedPCMData
        }

        var combinedAdpcm = Data()
        packets.forEach { combinedAdpcm.append($0.data) }
        guard let pcmData = BCLRingManager.shared.convertAdpcmToPcm(adpcmData: combinedAdpcm), !pcmData.isEmpty else {
            if hasListeners {
                sendEvent(withName: "onError", body: "Failed to convert ADPCM to PCM")
            }
            return Data()
        }
        return pcmData
    }

    private func openCaptureStream(format: CaptureAudioFormat,
                                   sessionID: Int,
                                   onPacket: @escaping (Result<(seq: Int, audioData: [Int]), BCLError>) -> Void) {
        switch format {
        case .adpcm:
            BCLRingManager.shared.controlADPCMFormatAudio(isOpen: true) { [weak self] result in
                guard let self else { return }
                guard self.isCapturingAudio, sessionID == self.captureSessionID else { return }
                switch result {
                case let .success(response):
                    onPacket(.success((seq: response.seq, audioData: response.audioData)))
                case let .failure(error):
                    onPacket(.failure(error))
                }
            }
        case .pcm:
            BCLRingManager.shared.controlPCMFormatAudio(isOpen: true) { [weak self] result in
                guard let self else { return }
                guard self.isCapturingAudio, sessionID == self.captureSessionID else { return }
                switch result {
                case let .success(response):
                    onPacket(.success((seq: response.seq ?? Int(Date().timeIntervalSince1970 * 1000), audioData: response.audioData)))
                case let .failure(error):
                    onPacket(.failure(error))
                }
            }
        }
    }

    private func handleIncomingPacket(seq: Int, audioData: [Int]) {
        let packetData = makeAudioPacketData(from: audioData)
        if !packetData.isEmpty {
            bufferedAudioPackets.append((seq: seq, data: packetData))
        }

        let elapsed = Date().timeIntervalSince1970 - captureStartTime
        if elapsed >= segmentDurationSeconds {
            flushCurrentAudioSegment()
            captureStartTime = Date().timeIntervalSince1970
        }
    }

    private func saveAsWav(pcmData: Data) -> String {
        let dir = audioDirectory()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let name = "\(formatter.string(from: Date())).wav"
        let fileURL = dir.appendingPathComponent(name)

        var wav = createWavHeader(dataSize: pcmData.count)
        wav.append(pcmData)
        try? wav.write(to: fileURL)

        return fileURL.path
    }

    private func audioDirectory() -> URL {
        let documentsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documentsDir.appendingPathComponent("ringmemoryapp/audio", isDirectory: true)
    }

    private func emitDebugLog(_ message: String) {
        guard hasListeners else { return }
        sendEvent(withName: "onDebugLog", body: [
            "timestamp": Int(Date().timeIntervalSince1970 * 1000),
            "message": message,
        ])
    }

    private func createWavHeader(dataSize: Int) -> Data {
        var data = Data()
        var fileSize = UInt32(dataSize + 36)
        var subChunkSize: UInt32 = 16
        var format: UInt16 = 1
        var channels: UInt16 = 1
        var sampleRate: UInt32 = 8000
        var byteRate: UInt32 = 16000
        var blockAlign: UInt16 = 2
        var bitsPerSample: UInt16 = 16
        var dataChunkSize = UInt32(dataSize)

        data.append("RIFF".data(using: .ascii)!)
        data.append(Data(bytes: &fileSize, count: 4))
        data.append("WAVE".data(using: .ascii)!)
        data.append("fmt ".data(using: .ascii)!)
        data.append(Data(bytes: &subChunkSize, count: 4))
        data.append(Data(bytes: &format, count: 2))
        data.append(Data(bytes: &channels, count: 2))
        data.append(Data(bytes: &sampleRate, count: 4))
        data.append(Data(bytes: &byteRate, count: 4))
        data.append(Data(bytes: &blockAlign, count: 2))
        data.append(Data(bytes: &bitsPerSample, count: 2))
        data.append("data".data(using: .ascii)!)
        data.append(Data(bytes: &dataChunkSize, count: 4))

        return data
    }
}

extension RTNRingModule: BCLPeripheralDelegate {
    func peripheralDidUpdateName(_: CBPeripheral) {}

    func peripheral(_: CBPeripheral, didReadRSSI _: NSNumber, error: Error?) {
        if let error {
            sendEvent(withName: "onError", body: "RSSI read error: \(error.localizedDescription)")
        }
    }

    func peripheral(_: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            sendEvent(withName: "onError", body: "Service discovery error: \(error.localizedDescription)")
        }
    }

    func peripheral(_: CBPeripheral, didDiscoverCharacteristicsFor _: CBService, error: Error?) {
        if let error {
            sendEvent(withName: "onError", body: "Characteristic discovery error: \(error.localizedDescription)")
        }
    }

    func peripheral(_: CBPeripheral, didUpdateValueFor _: CBCharacteristic, error: Error?) {
        if let error {
            sendEvent(withName: "onError", body: "Value update error: \(error.localizedDescription)")
        }
    }

    func peripheral(_: CBPeripheral, didWriteValueFor _: CBCharacteristic, error: Error?) {
        if let error {
            sendEvent(withName: "onError", body: "Write error: \(error.localizedDescription)")
        }
    }

    func peripheral(_: CBPeripheral, didUpdateNotificationStateFor _: CBCharacteristic, error: Error?) {
        if let error {
            sendEvent(withName: "onError", body: "Notification state error: \(error.localizedDescription)")
        }
    }
}
