import Foundation
import React
import BCLRingSDK

@objc(RTNRingModule)
class RTNRingModule: RCTEventEmitter {
    private var isScanning = false
    private var isCapturingAudio = false
    private var captureStartTime: TimeInterval = 0
    private var bufferedAudioPackets: [(seq: Int, data: Data)] = []
    private var connectedDeviceId: String?

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
        ]
    }

    @objc(addListener:)
    func addListener(_ eventName: String) {}

    @objc(removeListeners:)
    func removeListeners(_ count: Double) {}

    @objc(startScan:reject:)
    func startScan(_ resolve: @escaping RCTPromiseResolveBlock,
                   reject reject: @escaping RCTPromiseRejectBlock) {
        guard !isScanning else {
            reject("SCAN_ERROR", "Already scanning", nil)
            return
        }

        isScanning = true
        BCLRingManager.shared.startScan { [weak self] result in
            guard let self else { return }
            defer { self.isScanning = false }

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
                self.sendEvent(withName: "onDeviceFound", body: ["devices": payloadDevices])
                resolve(nil)
            case let .failure(error):
                reject("SCAN_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc(stopScan:reject:)
    func stopScan(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter _: @escaping RCTPromiseRejectBlock) {
        BCLRingManager.shared.stopScan()
        isScanning = false
        resolve(nil)
    }

    @objc(connectDevice:resolve:reject:)
    func connectDevice(_ deviceId: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       reject reject: @escaping RCTPromiseRejectBlock) {
        let connectCompletion: (Result<BCLDeviceInfoModel, BCLError>) -> Void = { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(device):
                self.connectedDeviceId = deviceId
                self.sendEvent(withName: "onDeviceConnected", body: [
                    "id": device.macAddress ?? device.uuidString,
                    "name": device.peripheralName ?? device.localName ?? "Smart Ring",
                    "batteryLevel": 100,
                    "macAddress": device.macAddress ?? "",
                    "uuidString": device.uuidString,
                ])
                resolve(true)
            case let .failure(error):
                reject("CONNECT_ERROR", error.localizedDescription, error)
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
                          reject reject: @escaping RCTPromiseRejectBlock) {
        BCLRingManager.shared.disconnect { [weak self] result in
            switch result {
            case .success:
                self?.isCapturingAudio = false
                self?.connectedDeviceId = nil
                self?.sendEvent(withName: "onDeviceDisconnected", body: [:])
                resolve(nil)
            case let .failure(error):
                reject("DISCONNECT_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc(getDeviceStatus:reject:)
    func getDeviceStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter _: @escaping RCTPromiseRejectBlock) {
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
                      reject reject: @escaping RCTPromiseRejectBlock) {
        guard !isCapturingAudio else {
            reject("CAPTURE_ERROR", "Already capturing", nil)
            return
        }
        guard BCLRingManager.shared.currentConnectedDevice != nil else {
            reject("CAPTURE_ERROR", "Device not connected", nil)
            return
        }

        isCapturingAudio = true
        captureStartTime = Date().timeIntervalSince1970
        bufferedAudioPackets.removeAll()

        BCLRingManager.shared.setActivePushAudioInfo(audioType: .adpcm) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.requestNextAudioFrame()
                resolve(nil)
            case let .failure(error):
                self.isCapturingAudio = false
                reject("CAPTURE_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc(stopCapture:reject:)
    func stopCapture(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter _: @escaping RCTPromiseRejectBlock) {
        isCapturingAudio = false
        BCLRingManager.shared.controlADPCMFormatAudio(isOpen: false) { [weak self] _ in
            self?.flushCurrentAudioSegment()
            resolve(nil)
        }
    }

    @objc(isCapturing:reject:)
    func isCapturing(_ resolve: @escaping RCTPromiseResolveBlock,
                     rejecter _: @escaping RCTPromiseRejectBlock) {
        resolve(isCapturingAudio)
    }

    @objc(checkForFirmwareUpdate:reject:)
    func checkForFirmwareUpdate(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter _: @escaping RCTPromiseRejectBlock) {
        resolve(nil)
    }

    @objc(updateFirmware:resolve:reject:)
    func updateFirmware(_: String,
                        resolver _: @escaping RCTPromiseResolveBlock,
                        reject reject: @escaping RCTPromiseRejectBlock) {
        reject("FIRMWARE_ERROR", "Firmware update not implemented", nil)
    }

    private func requestNextAudioFrame() {
        guard isCapturingAudio else { return }

        BCLRingManager.shared.controlADPCMFormatAudio(isOpen: true) { [weak self] result in
            guard let self else { return }

            switch result {
            case let .success(response):
                let int16Values = response.audioData.map { Int16($0) }
                let packetData = int16Values.withUnsafeBufferPointer { buffer -> Data in
                    guard let base = buffer.baseAddress else { return Data() }
                    return Data(bytes: base, count: buffer.count * MemoryLayout<Int16>.size)
                }

                if !packetData.isEmpty {
                    self.bufferedAudioPackets.append((seq: response.seq, data: packetData))
                }

                let elapsed = Date().timeIntervalSince1970 - self.captureStartTime
                if elapsed >= self.segmentDurationSeconds {
                    self.flushCurrentAudioSegment()
                    self.captureStartTime = Date().timeIntervalSince1970
                }

                if self.isCapturingAudio {
                    self.requestNextAudioFrame()
                }
            case let .failure(error):
                self.sendEvent(withName: "onError", body: "Audio stream failed: \(error.localizedDescription)")
                if self.isCapturingAudio {
                    // Retry after transient BLE packet failures.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        self.requestNextAudioFrame()
                    }
                }
            }
        }
    }

    private func flushCurrentAudioSegment() {
        guard !bufferedAudioPackets.isEmpty else { return }

        let sorted = bufferedAudioPackets.sorted { $0.seq < $1.seq }
        var combinedAdpcm = Data()
        sorted.forEach { combinedAdpcm.append($0.data) }

        guard let pcmData = BCLRingManager.shared.convertAdpcmToPcm(adpcmData: combinedAdpcm), !pcmData.isEmpty else {
            sendEvent(withName: "onError", body: "Failed to convert ADPCM to PCM")
            bufferedAudioPackets.removeAll()
            return
        }

        let outputPath = saveAsWav(pcmData: pcmData)
        let duration = Date().timeIntervalSince1970 - captureStartTime
        sendEvent(withName: "onAudioSegmentReady", body: [
            "filePath": outputPath,
            "duration": max(duration, 0),
            "timestamp": Int(captureStartTime * 1000),
            "size": pcmData.count,
        ])

        bufferedAudioPackets.removeAll()
    }

    private func saveAsWav(pcmData: Data) -> String {
        let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let dir = cachesDir.appendingPathComponent("ringmemoryapp/audio", isDirectory: true)
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
