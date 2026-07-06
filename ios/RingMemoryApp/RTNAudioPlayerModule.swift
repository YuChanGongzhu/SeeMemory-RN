import AVFoundation
import Foundation
import React

/// 通用本地/远程音频播放：iOS 用 AVAudioPlayer（本地文件）+ AVPlayer（远程 http(s) 流式播放）。
/// 与具体硬件设备无关，供 MR20、Rokid 等任何需要试听录音的地方复用。
@objc(RTNAudioPlayerModule)
class RTNAudioPlayerModule: NSObject {
    private var audioPlayer: AVAudioPlayer?
    private var remotePlayer: AVPlayer?

    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(playAudioFile:resolve:reject:)
    func playAudioFile(_ filePath: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
        if filePath.hasPrefix("http://") || filePath.hasPrefix("https://"),
           let remoteURL = URL(string: filePath) {
            do {
                let audioSession = AVAudioSession.sharedInstance()
                try audioSession.setCategory(.playback, mode: .default)
                try audioSession.setActive(true, options: [])
            } catch {
                reject("AUDIO_PLAYBACK_ERROR", error.localizedDescription, error)
                return
            }
            audioPlayer?.stop()
            remotePlayer?.pause()
            let asset = AVURLAsset(url: remoteURL)
            remotePlayer = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            remotePlayer?.play()
            Task {
                var seconds = 0.0
                if let dur = try? await asset.load(.duration) {
                    let s = CMTimeGetSeconds(dur)
                    if s.isFinite, s > 0 { seconds = s }
                }
                resolve([
                    "duration": seconds,
                    "size": 0,
                    "started": true,
                ])
            }
            return
        }

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
        remotePlayer?.pause()
        remotePlayer = nil
        resolve(nil)
    }
}
