import Foundation
import React
import CoreBluetooth

/// MR20「记忆粒」通用 BLE 原语（CoreBluetooth）。不含 GJJY 协议逻辑——
/// 协议编解码全在 JS 的 protocol.ts；本模块只做 扫描/连接/写/订阅/落盘。
/// 独立 LocalPod（RTNMr20Module），纯 CoreBluetooth，与 ring 设备/SDK 完全无关。
@objc(RTNMr20Module)
class RTNMr20Module: RCTEventEmitter {
  private let mr20ServiceUUID = CBUUID(string: "001120a0-2233-4455-6677-88995a5b5c5d")

  private var central: CBCentralManager!
  private var peripheral: CBPeripheral?
  private var discovered: [String: CBPeripheral] = [:]
  private var characteristics: [String: CBCharacteristic] = [:]
  private var hasListeners = false

  private var connectResolve: RCTPromiseResolveBlock?
  private var connectReject: RCTPromiseRejectBlock?
  private var pendingServiceCount = 0

  override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: nil)
  }

  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String]! {
    ["onDeviceFound", "onConnected", "onDisconnected", "onCharValue", "onError", "onBleState"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ name: String, _ body: Any) {
    sendEvent(withName: name, body: body)
  }

  @objc(addListener:)
  override func addListener(_ eventName: String) {
    super.addListener(eventName)
  }

  @objc(removeListeners:)
  override func removeListeners(_ count: Double) {
    super.removeListeners(count)
  }

  private func charKey(_ service: String, _ characteristic: String) -> String {
    "\(service.lowercased())|\(characteristic.lowercased())"
  }

  // MARK: - 蓝牙状态

  @objc(getBleState:reject:)
  func getBleState(_ resolve: @escaping RCTPromiseResolveBlock,
                   reject _: @escaping RCTPromiseRejectBlock) {
    resolve(stateString(central.state))
  }

  private func stateString(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "poweredOn"
    case .poweredOff: return "poweredOff"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    default: return "unknown"
    }
  }

  // MARK: - 扫描

  @objc(startScan:reject:)
  func startScan(_ resolve: @escaping RCTPromiseResolveBlock,
                 reject: @escaping RCTPromiseRejectBlock) {
    guard central.state == .poweredOn else {
      reject("BLE_OFF", "蓝牙未开启", nil)
      return
    }
    discovered.removeAll()
    // 扫全部设备：MR20 通常不在广播包里放 128 位服务 UUID，按 UUID 过滤会扫不到。
    // 连接后再用 discoverServices 校验 MR20 服务是否存在。
    central.scanForPeripherals(
      withServices: nil,
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
    )
    resolve(nil)
  }

  @objc(stopScan:reject:)
  func stopScan(_ resolve: @escaping RCTPromiseResolveBlock,
                reject _: @escaping RCTPromiseRejectBlock) {
    central.stopScan()
    resolve(nil)
  }

  // MARK: - 连接

  @objc(connect:resolve:reject:)
  func connect(_ deviceId: String,
               resolve: @escaping RCTPromiseResolveBlock,
               reject: @escaping RCTPromiseRejectBlock) {
    guard let target = discovered[deviceId] else {
      reject("NO_DEVICE", "设备未在扫描结果中，请先扫描", nil)
      return
    }
    central.stopScan()
    connectResolve = resolve
    connectReject = reject
    characteristics.removeAll()
    peripheral = target
    target.delegate = self
    central.connect(target, options: nil)
  }

  @objc(disconnect:reject:)
  func disconnect(_ resolve: @escaping RCTPromiseResolveBlock,
                  reject _: @escaping RCTPromiseRejectBlock) {
    if let p = peripheral {
      central.cancelPeripheralConnection(p)
    }
    resolve(nil)
  }

  // MARK: - 写 / 订阅

  @objc(writeNoResponse:characteristicUUID:base64Value:resolve:reject:)
  func writeNoResponse(_ serviceUUID: String,
                       characteristicUUID: String,
                       base64Value: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
    guard let p = peripheral,
          let ch = characteristics[charKey(serviceUUID, characteristicUUID)],
          let data = Data(base64Encoded: base64Value) else {
      reject("WRITE_ERR", "特征未就绪或数据无效", nil)
      return
    }
    let type: CBCharacteristicWriteType =
      ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
    p.writeValue(data, for: ch, type: type)
    resolve(nil)
  }

  @objc(monitor:characteristicUUID:resolve:reject:)
  func monitor(_ serviceUUID: String,
               characteristicUUID: String,
               resolve: @escaping RCTPromiseResolveBlock,
               reject: @escaping RCTPromiseRejectBlock) {
    guard let p = peripheral,
          let ch = characteristics[charKey(serviceUUID, characteristicUUID)] else {
      reject("MONITOR_ERR", "特征未就绪", nil)
      return
    }
    p.setNotifyValue(true, for: ch)
    resolve(nil)
  }

  // MARK: - 落盘（替代 blob-util）

  @objc(writeBase64File:base64Value:resolve:reject:)
  func writeBase64File(_ relativePath: String,
                       base64Value: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
    guard let data = Data(base64Encoded: base64Value) else {
      reject("FILE_ERR", "base64 解码失败", nil)
      return
    }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let fileURL = docs.appendingPathComponent(relativePath)
    do {
      try FileManager.default.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try data.write(to: fileURL)
      resolve(fileURL.path)
    } catch {
      reject("FILE_ERR", error.localizedDescription, error)
    }
  }

  /// 删除 Documents 下某个相对路径（文件或整个目录）。不存在视为成功。
  /// 用于「清除本地缓存」时把同步下来的录音文件从手机上真正删掉。
  @objc(deleteRelativePath:resolve:reject:)
  func deleteRelativePath(_ relativePath: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let target = docs.appendingPathComponent(relativePath)
    do {
      if FileManager.default.fileExists(atPath: target.path) {
        try FileManager.default.removeItem(at: target)
      }
      resolve(nil)
    } catch {
      reject("FILE_ERR", error.localizedDescription, error)
    }
  }

  private func failConnect(_ message: String) {
    connectReject?("CONNECT_ERR", message, nil)
    connectResolve = nil
    connectReject = nil
  }
}

// MARK: - CBCentralManagerDelegate

extension RTNMr20Module: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    emit("onBleState", ["state": stateString(central.state)])
  }

  func centralManager(_: CBCentralManager,
                      didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any],
                      rssi RSSI: NSNumber) {
    let id = peripheral.identifier.uuidString
    discovered[id] = peripheral
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
      ?? peripheral.name ?? "未知设备"
    emit("onDeviceFound", ["id": id, "name": name, "rssi": RSSI.intValue])
  }

  func centralManager(_: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([mr20ServiceUUID])
  }

  func centralManager(_: CBCentralManager,
                      didFailToConnect _: CBPeripheral,
                      error: Error?) {
    failConnect(error?.localizedDescription ?? "连接失败")
  }

  func centralManager(_: CBCentralManager,
                      didDisconnectPeripheral _: CBPeripheral,
                      error: Error?) {
    characteristics.removeAll()
    peripheral = nil
    emit("onDisconnected", ["reason": error?.localizedDescription ?? ""])
  }
}

// MARK: - CBPeripheralDelegate

extension RTNMr20Module: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error = error {
      failConnect("发现服务失败: \(error.localizedDescription)")
      return
    }
    let services = peripheral.services ?? []
    pendingServiceCount = services.count
    if services.isEmpty {
      failConnect("未发现服务")
      return
    }
    for service in services {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  func peripheral(_ peripheral: CBPeripheral,
                  didDiscoverCharacteristicsFor service: CBService,
                  error: Error?) {
    if let chars = service.characteristics {
      for ch in chars {
        let key = charKey(service.uuid.uuidString, ch.uuid.uuidString)
        characteristics[key] = ch
      }
    }
    pendingServiceCount -= 1
    if pendingServiceCount <= 0 {
      connectResolve?(true)
      connectResolve = nil
      connectReject = nil
      emit("onConnected", [
        "id": peripheral.identifier.uuidString,
        "name": peripheral.name ?? "记忆粒",
      ])
    }
  }

  func peripheral(_: CBPeripheral,
                  didUpdateValueFor characteristic: CBCharacteristic,
                  error: Error?) {
    if let error = error {
      emit("onError", ["code": "NOTIFY", "message": error.localizedDescription])
      return
    }
    guard let data = characteristic.value else { return }
    emit("onCharValue", [
      "characteristic": characteristic.uuid.uuidString.lowercased(),
      "value": data.base64EncodedString(),
    ])
  }

  func peripheral(_: CBPeripheral,
                  didWriteValueFor _: CBCharacteristic,
                  error: Error?) {
    if let error = error {
      emit("onError", ["code": "WRITE", "message": error.localizedDescription])
    }
  }
}
