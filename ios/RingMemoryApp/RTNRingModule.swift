import Foundation
import CoreBluetooth
import AVFoundation
import React
import BCLRingSDK

@_silgen_name("RNNoiseDenoisePCM16Mono8k")
private func RNNoiseDenoisePCM16Mono8k(_ input: UnsafePointer<Int16>?,
                                       _ sampleCount: Int32,
                                       _ output: UnsafeMutablePointer<Int16>?) -> Int32

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
    private var capturePacketOrder = 0
    private var pcmWarmupDeadline: TimeInterval = 0
    private var pcmCaptureStartTime: TimeInterval = 0
    private var pcmLastSeq: Int?
    private var pcmRestartCount = 0
    private var isRestartingPCMStream = false
    private let denoiseQueue = DispatchQueue(label: "com.ringmemoryapp.rnnoise", qos: .userInitiated)

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
        capturePacketOrder = 0
        pcmWarmupDeadline = format == .pcm ? Date().timeIntervalSince1970 + 0.35 : 0
        pcmCaptureStartTime = format == .pcm ? Date().timeIntervalSince1970 : 0
        pcmLastSeq = nil
        pcmRestartCount = 0
        isRestartingPCMStream = false
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
                        if !didSettlePromise {
                            self.isCapturingAudio = false
                            self.emitDebugLog("录音启动失败: \(error.localizedDescription)")
                            didSettlePromise = true
                            reject("CAPTURE_ERROR", error.localizedDescription, error)
                        } else {
                            self.emitDebugLog("\(format == .pcm ? "PCM" : "ADPCM")音频流中断，准备重试: \(error.localizedDescription)")
                            self.scheduleCaptureRetry(format: format, sessionID: sessionID, reason: error.localizedDescription)
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
                let fileName = url.lastPathComponent
                let isDenoised = fileName.hasSuffix("_rnnoise.wav")
                let sourceFilePath: String? = {
                    guard isDenoised else { return nil }
                    let sourceName = fileName.replacingOccurrences(of: "_rnnoise.wav", with: ".wav")
                    let sourceURL = url.deletingLastPathComponent().appendingPathComponent(sourceName)
                    return FileManager.default.fileExists(atPath: sourceURL.path) ? sourceURL.path : nil
                }()
                return [
                    "filePath": url.path,
                    "duration": duration,
                    "timestamp": modifiedAt,
                    "size": size,
                    "isDenoised": isDenoised,
                    "sourceFilePath": sourceFilePath as Any,
                ]
            }.sorted { lhs, rhs in
                (lhs["timestamp"] as? Int ?? 0) > (rhs["timestamp"] as? Int ?? 0)
            }

            resolve(items)
        } catch {
            reject("AUDIO_LIST_ERROR", error.localizedDescription, error)
        }
    }

    @objc(denoiseAudioFile:resolve:reject:)
    func denoiseAudioFile(_ filePath: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
        let sourceURL = URL(fileURLWithPath: filePath)
        guard FileManager.default.fileExists(atPath: sourceURL.path) else {
            reject("AUDIO_DENOISE_ERROR", "Audio file not found", nil)
            return
        }

        denoiseQueue.async { [weak self] in
            guard let self else { return }
            do {
                let segment = try self.createRNNoiseSegment(fromWavPath: sourceURL.path)
                DispatchQueue.main.async {
                    if self.hasListeners {
                        self.sendEvent(withName: "onAudioSegmentReady", body: segment)
                    }
                    resolve(segment)
                }
            } catch {
                DispatchQueue.main.async {
                    reject("AUDIO_DENOISE_ERROR", error.localizedDescription, error)
                }
            }
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
        let segmentTimestamp = Int(captureStartTime * 1000)
        emitDebugLog("\(currentCaptureFormat == .pcm ? "PCM" : "ADPCM")录音片段已保存: \((outputPath as NSString).lastPathComponent)")
        if hasListeners {
            sendEvent(withName: "onAudioSegmentReady", body: [
                "filePath": outputPath,
                "duration": max(duration, 0),
                "timestamp": segmentTimestamp,
                "size": pcmData.count,
                "isDenoised": false,
                "sourceFilePath": NSNull(),
            ])
        }

        runAutoRNNoiseDenoise(for: outputPath)

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
                                   onPacket: @escaping (Result<(seq: Int?, audioData: [Int]), BCLError>) -> Void) {
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
                    onPacket(.success((seq: response.seq, audioData: response.audioData)))
                case let .failure(error):
                    onPacket(.failure(error))
                }
            }
        }
    }

    private func handleIncomingPacket(seq: Int?, audioData: [Int]) {
        if currentCaptureFormat == .pcm, Date().timeIntervalSince1970 < pcmWarmupDeadline {
            // PCM startup packets can be unstable right after switching push format.
            return
        }

        if currentCaptureFormat == .pcm,
           let rawSeq = seq,
           shouldRestartPCMStream(for: rawSeq) {
            restartPCMStream()
            return
        }

        let packetSeq: Int
        if currentCaptureFormat == .pcm {
            capturePacketOrder += 1
            packetSeq = capturePacketOrder
        } else if let seq, seq > 0 {
            packetSeq = seq
        } else {
            capturePacketOrder += 1
            packetSeq = capturePacketOrder
        }

        if currentCaptureFormat == .pcm {
            pcmLastSeq = packetSeq
        }

        let packetData = makeAudioPacketData(from: audioData)
        if !packetData.isEmpty {
            bufferedAudioPackets.append((seq: packetSeq, data: packetData))
        }

        let elapsed = Date().timeIntervalSince1970 - captureStartTime
        if elapsed >= segmentDurationSeconds {
            flushCurrentAudioSegment()
            captureStartTime = Date().timeIntervalSince1970
        }
    }

    private func shouldRestartPCMStream(for rawSeq: Int) -> Bool {
        guard !isRestartingPCMStream else { return false }
        guard pcmRestartCount < 2 else { return false }
        guard pcmCaptureStartTime > 0 else { return false }

        let elapsed = Date().timeIntervalSince1970 - pcmCaptureStartTime
        guard elapsed > 1.0, elapsed < 12.0 else { return false }

        if let last = pcmLastSeq {
            // Align with SeeMemory's workaround: if stream still restarts from seq=1 after startup, re-open once.
            if rawSeq == 1, last > 1 {
                return true
            }
            // Another startup instability pattern: sequence jumps backward significantly.
            if rawSeq + 20 < last {
                return true
            }
        }

        return false
    }

    private func restartPCMStream() {
        guard isCapturingAudio, currentCaptureFormat == .pcm else { return }
        guard !isRestartingPCMStream else { return }
        let sessionID = captureSessionID
        isRestartingPCMStream = true
        pcmRestartCount += 1
        pcmLastSeq = nil
        pcmWarmupDeadline = Date().timeIntervalSince1970 + 0.35
        pcmCaptureStartTime = Date().timeIntervalSince1970
        emitDebugLog("PCM流检测到启动期异常，正在重启（第\(pcmRestartCount)次）")

        BCLRingManager.shared.controlPCMFormatAudio(isOpen: false) { [weak self] _ in
            guard let self else { return }
            guard self.isCapturingAudio, self.currentCaptureFormat == .pcm, sessionID == self.captureSessionID else {
                self.isRestartingPCMStream = false
                return
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                guard self.isCapturingAudio, self.currentCaptureFormat == .pcm, sessionID == self.captureSessionID else {
                    self.isRestartingPCMStream = false
                    return
                }

                BCLRingManager.shared.setActivePushAudioInfo(audioType: .pcm) { [weak self] configResult in
                    guard let self else { return }
                    guard self.isCapturingAudio, self.currentCaptureFormat == .pcm, sessionID == self.captureSessionID else {
                        self.isRestartingPCMStream = false
                        return
                    }

                    switch configResult {
                    case .success:
                        self.openCaptureStream(format: .pcm, sessionID: sessionID) { result in
                            switch result {
                            case let .success(response):
                                self.handleIncomingPacket(seq: response.seq, audioData: response.audioData)
                            case let .failure(error):
                                self.emitDebugLog("PCM流重启后仍失败，准备继续重试: \(error.localizedDescription)")
                                self.scheduleCaptureRetry(format: .pcm, sessionID: sessionID, reason: error.localizedDescription)
                            }
                        }
                    case let .failure(error):
                        self.emitDebugLog("PCM重配失败，准备继续重试: \(error.localizedDescription)")
                        self.scheduleCaptureRetry(format: .pcm, sessionID: sessionID, reason: error.localizedDescription)
                    }
                    self.isRestartingPCMStream = false
                }
            }
        }
    }

    private func scheduleCaptureRetry(format: CaptureAudioFormat, sessionID: Int, reason: String) {
        guard isCapturingAudio, sessionID == captureSessionID else { return }
        pendingCaptureRetry?.cancel()

        let retryWork = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.isCapturingAudio, sessionID == self.captureSessionID else { return }

            if format == .pcm {
                self.emitDebugLog("PCM流软重连中: \(reason)")
                self.restartPCMStream()
                return
            }

            self.emitDebugLog("ADPCM流软重连中: \(reason)")
            self.openCaptureStream(format: format, sessionID: sessionID) { result in
                switch result {
                case let .success(response):
                    self.handleIncomingPacket(seq: response.seq, audioData: response.audioData)
                case let .failure(error):
                    if self.hasListeners {
                        self.sendEvent(withName: "onError", body: "Audio stream failed: \(error.localizedDescription)")
                    }
                }
            }
        }

        pendingCaptureRetry = retryWork
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: retryWork)
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

    private func runAutoRNNoiseDenoise(for sourcePath: String) {
        denoiseQueue.async { [weak self] in
            guard let self else { return }
            do {
                let denoisedSegment = try self.createRNNoiseSegment(fromWavPath: sourcePath)
                DispatchQueue.main.async {
                    self.emitDebugLog("RNNoise降噪完成: \((denoisedSegment["filePath"] as? String ?? "unknown") as NSString)")
                    if self.hasListeners {
                        self.sendEvent(withName: "onAudioSegmentReady", body: denoisedSegment)
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.emitDebugLog("RNNoise降噪失败: \(error.localizedDescription)")
                }
            }
        }
    }

    private func createRNNoiseSegment(fromWavPath sourcePath: String) throws -> [String: Any] {
        let sourceURL = URL(fileURLWithPath: sourcePath)
        let sourceName = sourceURL.deletingPathExtension().lastPathComponent
        let denoisedURL = sourceURL.deletingLastPathComponent().appendingPathComponent("\(sourceName)_rnnoise.wav")

        if FileManager.default.fileExists(atPath: denoisedURL.path) {
            return try buildSegmentDict(fileURL: denoisedURL, sourceFilePath: sourcePath)
        }

        let wavData = try Data(contentsOf: sourceURL)
        guard wavData.count > 44 else {
            throw NSError(domain: "RTNRingModule", code: 3001, userInfo: [NSLocalizedDescriptionKey: "Invalid WAV file"]) 
        }

        let pcmData = wavData.subdata(in: 44 ..< wavData.count)
        guard let denoisedPCM = denoisePCMWithRNNoise(pcmData) else {
            throw NSError(domain: "RTNRingModule", code: 3002, userInfo: [NSLocalizedDescriptionKey: "RNNoise processing failed"]) 
        }

        var output = createWavHeader(dataSize: denoisedPCM.count)
        output.append(denoisedPCM)
        try output.write(to: denoisedURL, options: .atomic)

        return try buildSegmentDict(fileURL: denoisedURL, sourceFilePath: sourcePath)
    }

    private func denoisePCMWithRNNoise(_ pcmData: Data) -> Data? {
        guard !pcmData.isEmpty, pcmData.count % 2 == 0 else { return nil }
        let sampleCount = pcmData.count / MemoryLayout<Int16>.size
        var denoised = Data(count: pcmData.count)

        let processed = pcmData.withUnsafeBytes { inputBuffer -> Int32 in
            denoised.withUnsafeMutableBytes { outputBuffer -> Int32 in
                guard let inputBase = inputBuffer.bindMemory(to: Int16.self).baseAddress,
                      let outputBase = outputBuffer.bindMemory(to: Int16.self).baseAddress else {
                    return 0
                }
                return RNNoiseDenoisePCM16Mono8k(inputBase, Int32(sampleCount), outputBase)
            }
        }

        guard processed == Int32(sampleCount) else { return nil }
        return denoised
    }

    private func buildSegmentDict(fileURL: URL, sourceFilePath: String?) throws -> [String: Any] {
        let values = try fileURL.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let size = values.fileSize ?? 0
        let duration = max(Double(max(size - 44, 0)) / 16000.0, 0)
        let modifiedAt = Int((values.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000)
        return [
            "filePath": fileURL.path,
            "duration": duration,
            "timestamp": modifiedAt,
            "size": size,
            "isDenoised": true,
            "sourceFilePath": sourceFilePath as Any,
        ]
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
