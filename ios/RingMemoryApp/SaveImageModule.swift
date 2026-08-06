import Foundation
import Photos
import React
import UIKit

@objc(SaveImageModule)
class SaveImageModule: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        false
    }

    @objc(saveBase64ToCameraRoll:resolve:reject:)
    func saveBase64ToCameraRoll(_ base64Png: String,
                                 resolve: @escaping RCTPromiseResolveBlock,
                                 reject: @escaping RCTPromiseRejectBlock) {
        guard let data = Data(base64Encoded: base64Png), let image = UIImage(data: data) else {
            reject("INVALID_IMAGE", "Unable to decode base64 image data", nil)
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                reject("PERMISSION_DENIED", "Photo library access was not granted", nil)
                return
            }

            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, error in
                if success {
                    resolve(["success": true])
                } else {
                    reject("SAVE_FAILED", error?.localizedDescription ?? "Failed to save image", error)
                }
            }
        }
    }
}
