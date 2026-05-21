import Foundation
import UIKit
import AVFoundation
import React
import Combine
import RGCxrClient
import RGCoreKit

@objc(RTNRokidModule)
class RTNRokidModule: RCTEventEmitter, AVAudioPlayerDelegate {
    private let customAppPackageName = "com.rokid.cxrswithcxrl"
    private let client = CxrClient.shared
    private var cancellables = Set<AnyCancellable>()
    private var audioBuffer = Data()
    private var recordStartedAt: TimeInterval = 0
    private var isRecording = false
    private var audioPlayer: AVAudioPlayer?
    private var isCustomViewRunning = false
    private var pendingCustomViewResolve: RCTPromiseResolveBlock?
    private var pendingCustomViewReject: RCTPromiseRejectBlock?
    private var customViewOpenTimeout: DispatchWorkItem?

    override init() {
        super.init()
        RGLog.setup(false)
        bindEvents()
    }

    @objc override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func supportedEvents() -> [String]! {
        [
            "onRokidAuthStateChanged",
            "onRokidAuthEvent",
            "onRokidAudioData",
            "onRokidAudioSegmentReady",
            "onRokidCustomViewRunning",
            "onRokidAppResumeChanged",
            "onRokidPhotoReady",
            "onRokidError",
        ]
    }

    @objc override func addListener(_ eventName: String) {
        super.addListener(eventName)
    }

    @objc override func removeListeners(_ count: Double) {
        super.removeListeners(count)
    }

    private func bindEvents() {
        client.auth.statePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.sendEvent(withName: "onRokidAuthStateChanged", body: self?.authStatePayload(state))
            }
            .store(in: &cancellables)

        client.auth.eventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.sendEvent(withName: "onRokidAuthEvent", body: self?.authEventPayload(event))
            }
            .store(in: &cancellables)

        client.audioEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.handleAudioEvent(event)
            }
            .store(in: &cancellables)

        client.customViewRunningEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.handleCustomViewRunningEvent(event.isRunning)
            }
            .store(in: &cancellables)

        client.appResumeChangeEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                self?.sendEvent(withName: "onRokidAppResumeChanged", body: ["packageName": event.packageName])
            }
            .store(in: &cancellables)
    }

    @objc(initializeClient:appDisplayName:pageName:resolve:reject:)
    func initializeClient(_ mode: String,
                          appDisplayName: String?,
                          pageName: String?,
                          resolve: RCTPromiseResolveBlock,
                          reject _: RCTPromiseRejectBlock) {
        resolve([
            "initialized": true,
            "outcome": "ready",
            "mode": mode,
            "appDisplayName": emptyToNil(appDisplayName) as Any,
            "pageName": emptyToNil(pageName) as Any,
        ])
    }

    @objc(isRokidAppInstalled:reject:)
    func isRokidAppInstalled(_ resolve: RCTPromiseResolveBlock,
                             reject _: RCTPromiseRejectBlock) {
        resolve(canOpenRokidApp())
    }

    @objc(authenticate:appName:resolve:reject:)
    func authenticate(_ scopes: [String],
                      appName: String?,
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
        guard canOpenRokidApp() else {
            reject("ROKID_APP_MISSING", "Rokid AI App is not installed", nil)
            return
        }

        let requestedScopes = scopes.isEmpty ? ["device_control", "audio_stream"] : scopes
        client.auth.authenticate(scopes: requestedScopes, appName: emptyToNil(appName) ?? "SeeMemory") { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let auth):
                    resolve([
                        "token": auth.token,
                        "sessionId": auth.sessionId as Any,
                    ])
                case .failure(let error):
                    reject("ROKID_AUTH_ERROR", error.localizedDescription, error)
                }
            }
        }
    }

    @objc(getAuthState:reject:)
    func getAuthState(_ resolve: RCTPromiseResolveBlock,
                      reject _: RCTPromiseRejectBlock) {
        resolve(authStatePayload(client.auth.currentState))
    }

    @objc(clearAuthentication:reject:)
    func clearAuthentication(_ resolve: RCTPromiseResolveBlock,
                             reject _: RCTPromiseRejectBlock) {
        client.auth.clearAuthentication()
        resolve(nil)
    }

    @objc(queryCustomApp:reject:)
    func queryCustomApp(_ resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
        guard client.auth.isAuthenticated() else {
            reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before querying CustomApp", nil)
            return
        }

        client.queryApp(packageName: customAppPackageName) { [weak self] installed in
            DispatchQueue.main.async {
                resolve([
                    "installed": installed,
                    "packageName": self?.customAppPackageName ?? "",
                ])
            }
        }
    }

    @objc(openCustomApp:url:resolve:reject:)
    func openCustomApp(_ activityName: String,
                       url: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        guard client.auth.isAuthenticated() else {
            reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before opening CustomApp", nil)
            return
        }

        let targetActivity = activityName.isEmpty
            ? "com.rokid.cxrswithcxrl.activities.main.MainActivity"
            : activityName
        client.queryApp(packageName: customAppPackageName) { [weak self] installed in
            guard let self else { return }
            guard installed else {
                DispatchQueue.main.async {
                    reject("ROKID_CUSTOM_APP_MISSING", "CustomApp is not installed on the glasses", nil)
                }
                return
            }
            self.client.openApp(packageName: self.customAppPackageName, activityName: targetActivity, url: url) { success in
                DispatchQueue.main.async {
                    if success {
                        resolve(["success": true])
                    } else {
                        reject("ROKID_CUSTOM_APP_OPEN_FAILED", "Failed to open CustomApp on the glasses", nil)
                    }
                }
            }
        }
    }

    @objc(stopCustomApp:reject:)
    func stopCustomApp(_ resolve: @escaping RCTPromiseResolveBlock,
                       reject _: RCTPromiseRejectBlock) {
        client.stopApp(customAppPackageName) { success in
            DispatchQueue.main.async {
                resolve(["success": success])
            }
        }
    }

    @objc(openCustomView:resolve:reject:)
    func openCustomView(_ viewJson: String,
                        resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
        guard client.auth.isAuthenticated() else {
            reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before opening CustomView", nil)
            return
        }

        customViewOpenTimeout?.cancel()
        pendingCustomViewReject?("ROKID_CUSTOM_VIEW_CANCELLED", "A newer CustomView request replaced this one", nil)
        pendingCustomViewResolve = resolve
        pendingCustomViewReject = reject
        isCustomViewRunning = false

        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.pendingCustomViewReject != nil else { return }
            self.pendingCustomViewReject?("ROKID_CUSTOM_VIEW_TIMEOUT", "CustomView did not report running within 8 seconds", nil)
            self.pendingCustomViewResolve = nil
            self.pendingCustomViewReject = nil
        }
        customViewOpenTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)

        client.sendCustomViewIcons("[]")
        client.openCustomView(viewJson.isEmpty ? defaultCustomViewJson() : viewJson)
    }

    @objc(closeCustomView:resolve:reject:)
    func closeCustomView(_ viewJson: String,
                         resolve: @escaping RCTPromiseResolveBlock,
                         reject _: RCTPromiseRejectBlock) {
        customViewOpenTimeout?.cancel()
        pendingCustomViewResolve = nil
        pendingCustomViewReject = nil
        client.closeCustomView(viewJson)
        isCustomViewRunning = false
        resolve(["success": true])
    }

    @objc(startRecord:resolve:reject:)
    func startRecord(_ type: String,
                     resolve: RCTPromiseResolveBlock,
                     reject: RCTPromiseRejectBlock) {
        guard client.auth.isAuthenticated() else {
            reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before recording", nil)
            return
        }

        audioBuffer.removeAll()
        recordStartedAt = Date().timeIntervalSince1970
        isRecording = true
        client.startRecord(type.isEmpty ? "seememory" : type, codec: .pcm, mode: .antClose)
        resolve(nil)
    }

    @objc(stopRecord:resolve:reject:)
    func stopRecord(_ type: String,
                    resolve: RCTPromiseResolveBlock,
                    reject _: RCTPromiseRejectBlock) {
        client.stopRecord(type.isEmpty ? "seememory" : type)
        isRecording = false
        let segment = flushAudioSegment()
        resolve(segment)
    }

    @objc(takePhoto:height:quality:resolve:reject:)
    func takePhoto(_ width: Double,
                   height: Double,
                   quality: Double,
                   resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock) {
        guard client.auth.isAuthenticated() else {
            reject("ROKID_AUTH_REQUIRED", "Rokid authorization is required before taking photos", nil)
            return
        }

        client.takePhotoWithData(width: Int(width), height: Int(height), quality: Int(quality)) { [weak self] data in
            DispatchQueue.main.async {
                do {
                    let result = try self?.savePhoto(data: data)
                    self?.sendEvent(withName: "onRokidPhotoReady", body: result)
                    resolve(result)
                } catch {
                    reject("ROKID_PHOTO_ERROR", error.localizedDescription, error)
                }
            }
        }
    }

    @objc(playAudioFile:resolve:reject:)
    func playAudioFile(_ filePath: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        do {
            let url = URL(fileURLWithPath: normalizedPath(filePath))
            audioPlayer?.stop()
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.delegate = self
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
            resolve([
                "filePath": url.path,
                "duration": audioPlayer?.duration ?? 0,
            ])
        } catch {
            reject("ROKID_AUDIO_PLAYBACK_ERROR", error.localizedDescription, error)
        }
    }

    @objc(stopAudioPlayback:reject:)
    func stopAudioPlayback(_ resolve: RCTPromiseResolveBlock,
                           reject _: RCTPromiseRejectBlock) {
        audioPlayer?.stop()
        audioPlayer = nil
        resolve(nil)
    }

    @objc(getAudioWaveform:bars:resolve:reject:)
    func getAudioWaveform(_ filePath: String,
                          bars: Double,
                          resolve: RCTPromiseResolveBlock,
                          reject: RCTPromiseRejectBlock) {
        do {
            let values = try waveformValues(filePath: filePath, bars: max(Int(bars), 8))
            resolve(values)
        } catch {
            reject("ROKID_WAVEFORM_ERROR", error.localizedDescription, error)
        }
    }

    @objc(resolveMediaPath:resolve:reject:)
    func resolveMediaPath(_ filePath: String,
                          resolve: RCTPromiseResolveBlock,
                          reject _: RCTPromiseRejectBlock) {
        resolve(resolveExistingMediaPath(filePath) ?? "")
    }

    @objc(getSavedMedia:reject:)
    func getSavedMedia(_ resolve: RCTPromiseResolveBlock,
                       reject: RCTPromiseRejectBlock) {
        do {
            resolve([
                "recordings": try listSavedMedia(folder: "rokid-audio", extensions: ["wav"], isAudio: true),
                "photos": try listSavedMedia(folder: "rokid-photos", extensions: ["jpg", "jpeg"], isAudio: false),
            ])
        } catch {
            reject("ROKID_MEDIA_LIST_ERROR", error.localizedDescription, error)
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        audioPlayer = nil
    }

    private func handleCustomViewRunningEvent(_ isRunning: Bool) {
        isCustomViewRunning = isRunning
        sendEvent(withName: "onRokidCustomViewRunning", body: ["isRunning": isRunning])

        guard isRunning, let resolve = pendingCustomViewResolve else { return }
        customViewOpenTimeout?.cancel()
        pendingCustomViewResolve = nil
        pendingCustomViewReject = nil
        resolve(["success": true])
    }

    private func handleAudioEvent(_ event: RGCxrClientAudioEvent) {
        switch event {
        case .started(let started):
            sendEvent(withName: "onRokidAudioData", body: [
                "event": "started",
                "codec": started.codec,
                "type": started.type,
                "channels": started.channels,
            ])
        case .stream(let packet):
            if isRecording {
                audioBuffer.append(packet.data)
            }
            sendEvent(withName: "onRokidAudioData", body: [
                "event": "stream",
                "size": packet.data.count,
                "timestamp": NSNumber(value: packet.timestamp),
            ])
        @unknown default:
            sendEvent(withName: "onRokidError", body: ["event": "unknownAudioEvent"])
        }
    }

    private func flushAudioSegment() -> [String: Any] {
        guard !audioBuffer.isEmpty else {
            return [
                "filePath": "",
                "duration": 0,
                "timestamp": Int(recordStartedAt * 1000),
                "size": 0,
            ]
        }

        let pcm = audioBuffer
        audioBuffer.removeAll()
        let filePath = saveWavFile(pcmData: pcm)
        let duration = max(Date().timeIntervalSince1970 - recordStartedAt, 0)
        let payload: [String: Any] = [
            "filePath": filePath,
            "duration": duration,
            "timestamp": Int(recordStartedAt * 1000),
            "size": pcm.count,
        ]
        sendEvent(withName: "onRokidAudioSegmentReady", body: payload)
        return payload
    }

    private func saveWavFile(pcmData: Data) -> String {
        let dir = persistentMediaDirectory(folder: "rokid-audio")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let fileURL = dir.appendingPathComponent("rokid_\(formatter.string(from: Date())).wav")

        var wav = createWavHeader(dataSize: pcmData.count, sampleRate: 16000)
        wav.append(pcmData)
        try? wav.write(to: fileURL)
        return fileURL.path
    }

    private func normalizedPath(_ filePath: String) -> String {
        filePath.replacingOccurrences(of: "file://", with: "")
    }

    private func persistentMediaDirectory(folder: String) -> URL {
        let supportDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = supportDir.appendingPathComponent("ringmemoryapp/\(folder)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func legacyCacheMediaDirectory(folder: String) -> URL {
        let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        return cachesDir.appendingPathComponent("ringmemoryapp/\(folder)", isDirectory: true)
    }

    private func resolveExistingMediaPath(_ filePath: String) -> String? {
        let normalized = normalizedPath(filePath)
        if FileManager.default.fileExists(atPath: normalized) {
            return normalized
        }

        let fileName = URL(fileURLWithPath: normalized).lastPathComponent
        guard !fileName.isEmpty else { return nil }
        for folder in ["rokid-audio", "rokid-photos"] {
            for dir in [persistentMediaDirectory(folder: folder), legacyCacheMediaDirectory(folder: folder)] {
                let candidate = dir.appendingPathComponent(fileName)
                if FileManager.default.fileExists(atPath: candidate.path) {
                    return candidate.path
                }
            }
        }
        return nil
    }

    private func listSavedMedia(folder: String, extensions: Set<String>, isAudio: Bool) throws -> [[String: Any]] {
        let manager = FileManager.default
        let directories = [persistentMediaDirectory(folder: folder), legacyCacheMediaDirectory(folder: folder)]
        var seenFileNames = Set<String>()
        var items: [[String: Any]] = []

        for dir in directories {
            guard manager.fileExists(atPath: dir.path) else { continue }
            let urls = try manager.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
            )

            for url in urls {
                let ext = url.pathExtension.lowercased()
                guard extensions.contains(ext), !seenFileNames.contains(url.lastPathComponent) else { continue }
                seenFileNames.insert(url.lastPathComponent)

                let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                let size = values.fileSize ?? 0
                let timestamp = Int((values.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000)
                var payload: [String: Any] = [
                    "filePath": url.path,
                    "timestamp": timestamp,
                    "size": size,
                ]
                if isAudio {
                    payload["duration"] = max(Double(max(size - 44, 0)) / 32000.0, 0)
                }
                items.append(payload)
            }
        }

        return items.sorted { lhs, rhs in
            (lhs["timestamp"] as? Int ?? 0) > (rhs["timestamp"] as? Int ?? 0)
        }
    }

    private func waveformValues(filePath: String, bars: Int) throws -> [Double] {
        let url = URL(fileURLWithPath: normalizedPath(filePath))
        let data = try Data(contentsOf: url)
        let sampleData = extractWavDataChunk(data) ?? data.dropFirst(min(44, data.count))
        guard sampleData.count >= 2 else {
            return Array(repeating: 0, count: bars)
        }

        let sampleCount = sampleData.count / 2
        let samplesPerBar = max(sampleCount / bars, 1)
        var values: [Double] = []
        values.reserveCapacity(bars)

        for barIndex in 0..<bars {
            let startSample = barIndex * samplesPerBar
            let endSample = min(startSample + samplesPerBar, sampleCount)
            if startSample >= endSample {
                values.append(0)
                continue
            }

            var peak = 0
            for sampleIndex in startSample..<endSample {
                let offset = sampleData.startIndex + sampleIndex * 2
                let low = UInt16(sampleData[offset])
                let high = UInt16(sampleData[offset + 1]) << 8
                let sample = Int(Int16(bitPattern: high | low))
                peak = max(peak, abs(sample))
            }
            values.append(min(Double(peak) / 32768.0, 1.0))
        }

        return values
    }

    private func extractWavDataChunk(_ data: Data) -> Data? {
        guard data.count > 44 else { return nil }
        var index = 12
        while index + 8 <= data.count {
            let chunkId = String(data: data[index..<index + 4], encoding: .ascii)
            let sizeOffset = index + 4
            let chunkSize = UInt32(data[sizeOffset])
                | (UInt32(data[sizeOffset + 1]) << 8)
                | (UInt32(data[sizeOffset + 2]) << 16)
                | (UInt32(data[sizeOffset + 3]) << 24)
            let chunkStart = index + 8
            let chunkEnd = min(chunkStart + Int(chunkSize), data.count)
            if chunkId == "data", chunkStart < chunkEnd {
                return Data(data[chunkStart..<chunkEnd])
            }
            index = chunkEnd + (Int(chunkSize) % 2)
        }
        return nil
    }

    private func createWavHeader(dataSize: Int, sampleRate: UInt32) -> Data {
        var data = Data()
        var fileSize = UInt32(dataSize + 36)
        var subChunkSize: UInt32 = 16
        var format: UInt16 = 1
        var channels: UInt16 = 1
        var headerSampleRate = sampleRate
        var byteRate: UInt32 = sampleRate * 2
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
        data.append(Data(bytes: &headerSampleRate, count: 4))
        data.append(Data(bytes: &byteRate, count: 4))
        data.append(Data(bytes: &blockAlign, count: 2))
        data.append(Data(bytes: &bitsPerSample, count: 2))
        data.append("data".data(using: .ascii)!)
        data.append(Data(bytes: &dataChunkSize, count: 4))
        return data
    }

    private func savePhoto(data: Data) throws -> [String: Any] {
        let dir = persistentMediaDirectory(folder: "rokid-photos")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let fileURL = dir.appendingPathComponent("rokid_\(formatter.string(from: Date())).jpg")
        try data.write(to: fileURL)
        return [
            "filePath": fileURL.path,
            "timestamp": Int(Date().timeIntervalSince1970 * 1000),
            "size": data.count,
        ]
    }

    private func authStatePayload(_ state: RGCxrClientAuthState) -> [String: Any] {
        switch state {
        case .notAuthenticated:
            return ["status": "notAuthenticated", "isAuthenticated": false]
        case .authenticating:
            return ["status": "authenticating", "isAuthenticated": false]
        case .authenticated(let token, let expiresAt):
            return [
                "status": "authenticated",
                "isAuthenticated": true,
                "token": token,
                "expiresAt": expiresAt as Any,
            ]
        case .expired:
            return ["status": "expired", "isAuthenticated": false]
        case .failed(let error):
            return ["status": "failed", "isAuthenticated": false, "error": error]
        @unknown default:
            return ["status": "unknown", "isAuthenticated": false]
        }
    }

    private func authEventPayload(_ event: RGCxrClientAuthEvent) -> [String: Any] {
        switch event {
        case .stateChanged(let state):
            return ["event": "stateChanged", "state": authStatePayload(state)]
        case .authenticationSucceeded(let token, let sessionId, let deviceName):
            return [
                "event": "authenticationSucceeded",
                "token": token,
                "sessionId": sessionId as Any,
                "deviceName": deviceName as Any,
            ]
        case .authenticationFailed(let error):
            return ["event": "authenticationFailed", "error": error]
        case .tokenExpired:
            return ["event": "tokenExpired"]
        @unknown default:
            return ["event": "unknown"]
        }
    }

    private func canOpenRokidApp() -> Bool {
        guard let url = URL(string: "rokidai://connect") else { return false }
        if Thread.isMainThread {
            return UIApplication.shared.canOpenURL(url)
        }
        return DispatchQueue.main.sync {
            UIApplication.shared.canOpenURL(url)
        }
    }

    private func emptyToNil(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private func defaultCustomViewJson() -> String {
        """
        {"type":"LinearLayout","props":{"layout_width":"match_parent","layout_height":"match_parent","orientation":"vertical","gravity":"center","paddingTop":"140dp","paddingBottom":"100dp","paddingStart":"24dp","paddingEnd":"24dp","backgroundColor":"#FF000000"},"children":[{"type":"TextView","props":{"id":"title","layout_width":"wrap_content","layout_height":"wrap_content","text":"SeeMemory 已连接","textColor":"#FF00FF00","textSize":"20sp","textStyle":"bold"}},{"type":"TextView","props":{"id":"subtitle","layout_width":"wrap_content","layout_height":"wrap_content","text":"iOS CXR-L","textColor":"#FFFFFFFF","textSize":"14sp","marginTop":"12dp"}}]}
        """
    }

}
