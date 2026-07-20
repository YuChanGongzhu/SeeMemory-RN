import Foundation
import React
import CoreBluetooth
import NetworkExtension
import Network

/// 单次 WiFi 快传的上下文：TCP 连接 + 落盘句柄 + 收流计数 + connect/receive 两段回调。
/// 「先连后收」两步共享它（wifiConnect 建连接，wifiReceiveFile 在其上收流）。
private final class WifiXfer {
  // 连接阶段可能重试多次（DHCP 未就绪→重建连接），故 conn 可替换。
  var conn: NWConnection?
  var connSettled = false
  var connResolve: RCTPromiseResolveBlock?
  var connReject: RCTPromiseRejectBlock?
  var handle: FileHandle?
  var expected = 0 // 落盘目标字节（不含 5 字节尾标）
  var written = 0
  var receivedTotal = 0
  var recvSettled = false
  var recvResolve: RCTPromiseResolveBlock?
  var recvReject: RCTPromiseRejectBlock?
  var filePath = ""
  /// 收流停滞看门狗：每收到一批字节重新计时，超时未再来字节即判定停滞并拒绝本文件。
  /// 没有它时设备中途「不推也不关连」会让 conn.receive 永久挂起（JS 侧无超时 → 进度条永久卡住）。
  var idleTimer: DispatchWorkItem?
  init() {}
}

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

  // WiFi 快传：进行中的传输上下文（按 transferId 索引，供 abort）+ 已加入的热点 SSID。
  private var wifiXfers: [String: WifiXfer] = [:]
  private var joinedSSID: String?
  private let wifiQueue = DispatchQueue(label: "mr20.wifi")

  override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: nil)
  }

  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String]! {
    ["onDeviceFound", "onConnected", "onDisconnected", "onCharValue", "onError", "onBleState", "onWifiProgress"]
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

  /// 返回当前沙盒 Documents 绝对路径。读取端据此 + 相对路径现算绝对路径，
  /// 避免持久化的绝对路径因容器 UUID 变化（重装/恢复）而失效。
  @objc(getDocumentsDir:reject:)
  func getDocumentsDir(_ resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
    guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      reject("FILE_ERR", "无法定位 Documents 目录", nil)
      return
    }
    resolve(docs.path)
  }

  // MARK: - WiFi 快传（NEHotspotConfiguration 入网 + Network.framework 收流）

  /// 程序化加入设备热点。系统弹一次确认框；已关联也视为成功。失败 resolve(false)，
  /// 上层降级到引导手动连接。
  @objc(wifiJoin:pwd:timeoutMs:resolve:reject:)
  func wifiJoin(_ ssid: String,
                pwd: String,
                timeoutMs _: Double,
                resolve: @escaping RCTPromiseResolveBlock,
                reject _: @escaping RCTPromiseRejectBlock) {
    let config = NEHotspotConfiguration(ssid: ssid, passphrase: pwd, isWEP: false)
    config.joinOnce = true // 不持久化，App 退出/传完即释放
    NEHotspotConfigurationManager.shared.apply(config) { [weak self] error in
      if let e = error as NSError? {
        if e.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
          self?.joinedSSID = ssid
          resolve(true)
        } else {
          resolve(false)
        }
        return
      }
      self?.joinedSSID = ssid
      resolve(true)
    }
  }

  /// 移除已加入的设备热点配置（释放，回到原网络）。
  @objc(wifiLeave:reject:)
  func wifiLeave(_ resolve: @escaping RCTPromiseResolveBlock,
                 reject _: @escaping RCTPromiseRejectBlock) {
    if let ssid = joinedSSID {
      NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
      joinedSSID = nil
    }
    resolve(nil)
  }

  /// 中断指定 transferId 的连接/接收（关 socket）。不存在视为成功。
  @objc(wifiAbort:resolve:reject:)
  func wifiAbort(_ transferId: String,
                 resolve: @escaping RCTPromiseResolveBlock,
                 reject _: @escaping RCTPromiseRejectBlock) {
    if let xfer = wifiXfers[transferId] {
      xfer.connSettled = true // 阻止重试循环在 abort 后继续重连
      xfer.conn?.cancel()
      // 批末关闭（无进行中收流）：直接清理，避免长连接方案下 xfer 逐批累积；
      // 有进行中收流时保留，交给 .cancelled → failRecv 拒绝该文件并清理。
      if xfer.recvResolve == nil && xfer.recvReject == nil {
        wifiXfers.removeValue(forKey: transferId)
      }
    }
    resolve(nil)
  }

  /// 建立到 host:port 的 TCP 连接（**必须早于 BLE 下发 W 指令**，否则设备推的字节丢失卡 0）。
  /// socket ready 即 resolve。
  ///
  /// ⚠️ DHCP 竞态（0703 固件反馈报告核心）：`wifiJoin`(NEHotspotConfiguration) 在热点**关联成功即返回**，
  /// 但此刻手机尚未从设备 AP 拿到 `192.168.200.x` 地址；过早连 socket 会 `.failed`/超时收 0 字节，
  /// 表现为「有些记忆粒连接不上」。故这里在总窗口内**退避重试**建连，等 DHCP 就绪后 socket 自然 ready。
  /// requiredInterfaceType=.wifi 强制走设备热点（避免走蜂窝）。
  @objc(wifiConnect:port:transferId:resolve:reject:)
  func wifiConnect(_ host: String,
                   port: Double,
                   transferId: String,
                   resolve: @escaping RCTPromiseResolveBlock,
                   reject: @escaping RCTPromiseRejectBlock) {
    let nwHost = Network.NWEndpoint.Host(host)
    let nwPort = Network.NWEndpoint.Port(rawValue: UInt16(port)) ?? 8475

    let xfer = WifiXfer()
    xfer.connResolve = resolve
    xfer.connReject = reject
    wifiXfers[transferId] = xfer

    // 总窗口 25s：覆盖热点关联 + DHCP 拿到 192.168.200.x + 设备 socket 起监听的最坏耗时。
    let deadline = DispatchTime.now() + 25
    attemptWifiConnect(transferId, host: nwHost, port: nwPort, deadline: deadline)
  }

  /// 单次建连尝试；`.failed` 时在 deadline 内退避 1s 重试，`.waiting`（暂无路由/DHCP 未就绪）
  /// 交给 NWConnection 自行等待恢复，仅由 deadline 兜底超时。
  private func attemptWifiConnect(_ transferId: String,
                                  host: Network.NWEndpoint.Host,
                                  port: Network.NWEndpoint.Port,
                                  deadline: DispatchTime) {
    guard let xfer = wifiXfers[transferId], !xfer.connSettled else { return }
    let params = NWParameters.tcp
    params.requiredInterfaceType = .wifi
    let conn = NWConnection(host: host, port: port, using: params)
    xfer.conn = conn

    conn.stateUpdateHandler = { [weak self] state in
      guard let self = self else { return }
      guard let xfer = self.wifiXfers[transferId] else { return }
      switch state {
      case .ready:
        if !xfer.connSettled {
          xfer.connSettled = true
          xfer.connResolve?(nil)
        }
      case let .failed(err):
        if xfer.connSettled {
          // 已进入收流阶段后断开 → 收流失败。
          self.failRecv(transferId, err.localizedDescription)
          return
        }
        // 连接阶段失败（多为 DHCP 未就绪/设备 socket 未起）：窗口内退避重试。
        // 退避 0.25s（原 1s 过冲）：正常整批走长连接不重连；仅初次建连/异常重连时用到，缩短空档。
        conn.stateUpdateHandler = nil
        conn.cancel()
        if DispatchTime.now() < deadline {
          self.wifiQueue.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.attemptWifiConnect(transferId, host: host, port: port, deadline: deadline)
          }
        } else {
          xfer.connSettled = true
          xfer.connReject?(
            "WIFI_CONN_TIMEOUT",
            "连接设备热点超时（未获取到 192.168.200.x 地址，请确认已加入设备热点）",
            nil)
          self.wifiXfers.removeValue(forKey: transferId)
        }
      case .cancelled:
        // 收流阶段的中断才算失败；连接重试/abort 前的主动 cancel 不在此处理。
        if xfer.connSettled, xfer.recvResolve != nil || xfer.recvReject != nil {
          self.failRecv(transferId, "已中断")
        }
      default:
        break
      }
    }
    conn.start(queue: wifiQueue)

    // deadline 兜底：卡在 .waiting（DHCP 始终拿不到）时也能超时收尾。
    wifiQueue.asyncAfter(deadline: deadline) { [weak self] in
      guard let self = self,
            let xfer = self.wifiXfers[transferId], !xfer.connSettled else { return }
      xfer.connSettled = true
      xfer.conn?.stateUpdateHandler = nil
      xfer.conn?.cancel()
      xfer.connReject?(
        "WIFI_CONN_TIMEOUT",
        "连接设备热点超时（未获取到 192.168.200.x 地址，请确认已加入设备热点）",
        nil)
      self.wifiXfers.removeValue(forKey: transferId)
    }
  }

  /// 在 wifiConnect 建好的 socket 上收流，落盘到 Documents/relativePath，返回绝对路径。
  /// 按 expectedLen 长度剥离尾部 5 字节结束标记（BA 5A 02 8F 04）：只写到 expectedLen 为止，超出即标记丢弃。
  @objc(wifiReceiveFile:expectedLen:transferId:resolve:reject:)
  func wifiReceiveFile(_ relativePath: String,
                       expectedLen: Double,
                       transferId: String,
                       resolve: @escaping RCTPromiseResolveBlock,
                       reject: @escaping RCTPromiseRejectBlock) {
    guard let xfer = wifiXfers[transferId] else {
      reject("WIFI_NO_CONN", "socket 未连接（请先 wifiConnect）", nil)
      return
    }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let fileURL = docs.appendingPathComponent(relativePath)
    do {
      try FileManager.default.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      FileManager.default.createFile(atPath: fileURL.path, contents: nil)
    } catch {
      reject("WIFI_FILE_ERR", error.localizedDescription, error)
      return
    }
    guard let handle = try? FileHandle(forWritingTo: fileURL) else {
      reject("WIFI_FILE_ERR", "无法打开文件写入", nil)
      return
    }
    xfer.handle = handle
    xfer.expected = max(0, Int(expectedLen))
    xfer.filePath = fileURL.path
    xfer.recvResolve = resolve
    xfer.recvReject = reject
    armIdleWatchdog(transferId)
    receiveLoop(transferId)
  }

  /// 收流停滞看门狗：`WIFI_IDLE_TIMEOUT` 内没有新字节就判本文件失败并拆连接，
  /// 让 JS 侧（wifiSyncFiles 的 WIFI_MAX_ATTEMPTS 循环）重连续传，而不是无限等。
  /// 每收到一批字节重新计时；成功/失败结算时取消。
  private static let wifiIdleTimeout: TimeInterval = 12

  private func armIdleWatchdog(_ transferId: String) {
    guard let xfer = wifiXfers[transferId] else { return }
    xfer.idleTimer?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self = self, let x = self.wifiXfers[transferId], !x.recvSettled else { return }
      self.failRecv(
        transferId,
        "传输停滞（\(Int(Self.wifiIdleTimeout))s 未收到数据，已收 \(x.written)/\(x.expected) 字节）")
    }
    xfer.idleTimer = work
    wifiQueue.asyncAfter(deadline: .now() + Self.wifiIdleTimeout, execute: work)
  }

  private func receiveLoop(_ transferId: String) {
    guard let xfer = wifiXfers[transferId] else { return }
    let markerLen = 5
    guard let conn = xfer.conn else { return }
    conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
      [weak self] data, _, isComplete, error in
      guard let self = self, let xfer = self.wifiXfers[transferId] else { return }
      if let error = error {
        self.failRecv(transferId, error.localizedDescription)
        return
      }
      if let data = data, !data.isEmpty {
        self.armIdleWatchdog(transferId) // 有新字节 → 停滞计时重新开始
        xfer.receivedTotal += data.count
        if xfer.written < xfer.expected {
          let canWrite = min(data.count, xfer.expected - xfer.written)
          if canWrite > 0 {
            xfer.handle?.write(Data(data.prefix(canWrite)))
            xfer.written += canWrite
          }
        }
        self.emit("onWifiProgress", [
          "transferId": transferId,
          "received": xfer.written,
          "total": xfer.expected,
        ])
      }
      if xfer.written >= xfer.expected && xfer.receivedTotal >= xfer.expected + markerLen {
        self.finishRecvOk(transferId)
        return
      }
      if isComplete {
        // 连接关闭：只有整文件已落盘（written>=expected）才算成功；否则按「截断」失败。
        // 否则设备在上一文件 socket 拆除后尚未就绪就关闭本次连接时，会写入 0/半包却被误报成功，
        // 表现为「显示 N 个上传成功，实际只到一半」，且这些半包 MP3 之后无法播放。
        if xfer.written >= xfer.expected {
          self.finishRecvOk(transferId)
        } else {
          self.failRecv(transferId, "连接提前关闭，仅收到 \(xfer.written)/\(xfer.expected) 字节")
        }
        return
      }
      if xfer.recvSettled { return }
      self.receiveLoop(transferId)
    }
  }

  private func finishRecvOk(_ transferId: String) {
    guard let xfer = wifiXfers[transferId], !xfer.recvSettled else { return }
    // 复用长连接：关掉本文件句柄、复位单文件计数，但**不 cancel、不移除 xfer、不清 stateUpdateHandler**，
    // 让整批后续文件在同一 socket 上继续收流（消除逐条重连的 ~1s 空档）。连接由 wifiAbort 在批末统一关闭；
    // 若设备在文件间自行关连，则由 .failed/.cancelled → failRecv 拆掉，JS 侧据此重连兜底。
    xfer.idleTimer?.cancel()
    xfer.idleTimer = nil
    try? xfer.handle?.close()
    let path = xfer.filePath
    let resolve = xfer.recvResolve
    xfer.handle = nil
    xfer.written = 0
    xfer.receivedTotal = 0
    xfer.filePath = ""
    xfer.recvResolve = nil
    xfer.recvReject = nil
    resolve?(path)
  }

  private func failRecv(_ transferId: String, _ msg: String) {
    guard let xfer = wifiXfers[transferId], !xfer.recvSettled else { return }
    xfer.recvSettled = true
    xfer.idleTimer?.cancel()
    xfer.idleTimer = nil
    try? xfer.handle?.close()
    xfer.conn?.stateUpdateHandler = nil
    xfer.conn?.cancel()
    wifiXfers.removeValue(forKey: transferId)
    xfer.recvReject?("WIFI_RECV_ERR", msg, nil)
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
