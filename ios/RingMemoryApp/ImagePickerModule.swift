import Foundation
import ImageIO
import PhotosUI
import React
import UniformTypeIdentifiers
import UIKit

@objc(ImagePickerModule)
class ImagePickerModule: NSObject, PHPickerViewControllerDelegate {
    private var resolveBlock: RCTPromiseResolveBlock?
    private var rejectBlock: RCTPromiseRejectBlock?

    @objc static func requiresMainQueueSetup() -> Bool {
        true
    }

    @objc(pickImage:reject:)
    func pickImage(_ resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock) {
        if resolveBlock != nil || rejectBlock != nil {
            reject("PICK_IN_PROGRESS", "Image picking is already in progress", nil)
            return
        }

        let presentPicker = { [weak self] in
            guard let self else { return }
            guard let presenter = Self.topViewController() else {
                reject("NO_VIEW_CONTROLLER", "Unable to find a view controller to present image picker", nil)
                return
            }

            self.resolveBlock = resolve
            self.rejectBlock = reject

            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.selectionLimit = 1
            configuration.filter = .images
            configuration.preferredAssetRepresentationMode = .current

            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }

        if Thread.isMainThread {
            presentPicker()
        } else {
            DispatchQueue.main.async(execute: presentPicker)
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)

        guard let result = results.first else {
            resolveAndReset(["didCancel": true])
            return
        }

        let provider = result.itemProvider
        let imageType = UTType.image.identifier

        if provider.hasItemConformingToTypeIdentifier(imageType) {
            provider.loadFileRepresentation(forTypeIdentifier: imageType) { [weak self] url, error in
                guard let self else { return }
                if let error {
                    self.rejectAndReset(code: "PICK_FAILED", message: error.localizedDescription, error: error)
                    return
                }

                guard let url else {
                    self.rejectAndReset(code: "NO_FILE", message: "Unable to read selected image", error: nil)
                    return
                }

                do {
                    let copied = try self.copySelectedFile(from: url, suggestedName: provider.suggestedName)
                    let values = try copied.resourceValues(forKeys: [.fileSizeKey])
                    let imageMeta = self.readImageMetadata(from: copied)

                    var payload: [String: Any] = [
                        "didCancel": false,
                        "filePath": copied.path,
                        "uri": copied.absoluteString,
                        "fileName": copied.lastPathComponent,
                        "mimeType": self.mimeType(for: copied),
                        "fileSize": values.fileSize ?? 0,
                    ]
                    if let width = imageMeta.width {
                        payload["width"] = width
                    }
                    if let height = imageMeta.height {
                        payload["height"] = height
                    }

                    self.resolveAndReset(payload)
                } catch {
                    self.rejectAndReset(code: "COPY_FAILED", message: error.localizedDescription, error: error)
                }
            }
            return
        }

        rejectAndReset(code: "UNSUPPORTED", message: "Selected item is not an image", error: nil)
    }

    private func copySelectedFile(from sourceURL: URL, suggestedName: String?) throws -> URL {
        let ext = sourceURL.pathExtension.isEmpty ? "jpg" : sourceURL.pathExtension
        let suggested = suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseName = (suggested?.isEmpty == false ? suggested! : UUID().uuidString)
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("chat-images", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let destination = tempDir.appendingPathComponent("\(baseName)-\(UUID().uuidString).\(ext)")

        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }

        try FileManager.default.copyItem(at: sourceURL, to: destination)
        return destination
    }

    private func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension),
           let mimeType = type.preferredMIMEType {
            return mimeType
        }
        return "image/jpeg"
    }

    private func readImageMetadata(from url: URL) -> (width: Int?, height: Int?) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
            return (nil, nil)
        }
        let width = properties[kCGImagePropertyPixelWidth] as? Int
        let height = properties[kCGImagePropertyPixelHeight] as? Int
        return (width, height)
    }

    private func resolveAndReset(_ payload: [String: Any]) {
        let resolve = resolveBlock
        resetBlocks()
        resolve?(payload)
    }

    private func rejectAndReset(code: String, message: String, error: Error?) {
        let reject = rejectBlock
        resetBlocks()
        reject?(code, message, error)
    }

    private func resetBlocks() {
        resolveBlock = nil
        rejectBlock = nil
    }

    private static func topViewController(base: UIViewController? = {
        if #available(iOS 13.0, *) {
            return UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first(where: \.isKeyWindow)?
                .rootViewController
        }
        return UIApplication.shared.keyWindow?.rootViewController
    }()) -> UIViewController? {
        if let nav = base as? UINavigationController {
            return topViewController(base: nav.visibleViewController)
        }
        if let tab = base as? UITabBarController, let selected = tab.selectedViewController {
            return topViewController(base: selected)
        }
        if let presented = base?.presentedViewController {
            return topViewController(base: presented)
        }
        return base
    }
}
