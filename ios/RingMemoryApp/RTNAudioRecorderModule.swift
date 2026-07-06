import AVFoundation
import Foundation
import React

/// 手机麦克风录音（通用，与具体硬件设备无关）：AVAudioRecorder 录成 m4a/AAC，
/// 供「记忆对话」语音输入等场景使用。同一时刻只维护一路录音。
@objc(RTNAudioRecorderModule)
class RTNAudioRecorderModule: NSObject {
    private var recorder: AVAudioRecorder?
    private var currentPath: String?

    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    /// 请求麦克风权限，resolve(true/false)。
    @objc(requestPermission:reject:)
    func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                           reject _: @escaping RCTPromiseRejectBlock) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            resolve(granted)
        }
    }

    @objc(startRecording:reject:)
    func startRecording(_ resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true, options: [])
        } catch {
            reject("AUDIO_RECORD_ERROR", "Failed to activate audio session: \(error.localizedDescription)", error)
            return
        }

        // 存到 Documents/voice（持久目录），保证语音消息重开 App 后仍能本地回听。
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("voice", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileName = "voice-\(Int(Date().timeIntervalSince1970 * 1000)).m4a"
        let url = dir.appendingPathComponent(fileName)
        // 16kHz 单声道 AAC：识别足够、文件小、上传快。
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.prepareToRecord()
            guard rec.record() else {
                reject("AUDIO_RECORD_ERROR", "Recorder failed to start", nil)
                return
            }
            recorder = rec
            currentPath = url.path
            resolve(nil)
        } catch {
            reject("AUDIO_RECORD_ERROR", error.localizedDescription, error)
        }
    }

    @objc(stopRecording:reject:)
    func stopRecording(_ resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        guard let rec = recorder, let path = currentPath else {
            reject("AUDIO_RECORD_ERROR", "No active recording", nil)
            return
        }
        // currentTime 仅在录音中有效，需在 stop 前读取。
        let durationMs = Int(rec.currentTime * 1000)
        rec.stop()
        recorder = nil
        currentPath = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        resolve(["filePath": path, "durationMs": durationMs])
    }

    @objc(cancelRecording:reject:)
    func cancelRecording(_ resolve: @escaping RCTPromiseResolveBlock,
                         reject _: @escaping RCTPromiseRejectBlock) {
        if let rec = recorder {
            rec.stop()
            rec.deleteRecording()
        }
        recorder = nil
        if let path = currentPath {
            try? FileManager.default.removeItem(atPath: path)
        }
        currentPath = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        resolve(nil)
    }
}
