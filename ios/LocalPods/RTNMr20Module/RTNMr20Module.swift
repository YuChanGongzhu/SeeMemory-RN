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

  // OTA 无响应写的背压：canSendWriteWithoutResponse 为 false 时挂起，
  // 等 peripheralIsReady 回调再发。JS 侧逐帧 await，故同时至多一个待发。
  // RN 方法队列与 CoreBluetooth 回调队列（main）不是同一条，故必须加锁。
  private var pendingWrite: (() -> Void)?
  private let pendingWriteLock = NSLock()

  // 带应答写（OTA 固件帧用）。无响应写只保证数据交给了对方**控制器**，链路层会自动
  // 重传所以空中不丢；但设备主机侧在擦 flash 来不及取时会把包静默丢掉，本机的
  // canSendWriteWithoutResponse 完全看不见——真机现象就是 3536 帧一路畅通、
  // 收完却回 OT&ERR（包内校验和对不上）。带应答写的 ACK 由设备**主机协议栈**发出，
  // 它忙着擦 flash 就不会应答，于是 iOS 自然等着，丢包在物理上不可能发生。
  // didWriteValueFor 按发出顺序回调，故用 FIFO 队列；带上 charKey 是因为该回调对
  // 本外设所有 with-response 写都会触发（writeNoResponse 在特征不支持无应答时也会走
  // .withResponse），不比对就会把别人的回调当成自己的。
  private var ackWrites: [(key: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)] = []
  private let ackWritesLock = NSLock()

  // OTA 定时发帧：整个发送循环在这条专属串行队列上跑，与 JS 线程和 main 队列都无关，
  // 这样 20ms 的节奏不会被 React 重渲染或桥上的排队拖慢（见 otaSendFrames）。
  private var otaTimer: DispatchSourceTimer?
  private var otaAborted = false
  private let otaQueue = DispatchQueue(label: "mr20.ota")
  private let otaLock = NSLock()

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
    ["onDeviceFound", "onConnected", "onDisconnected", "onCharValue", "onError", "onBleState",
     "onWifiProgress", "onOtaProgress", "onWifiLog"]
  }

  /// 把原生侧 WiFi 入网过程的每一步推给 JS，合进同一条协议日志。
  ///
  /// 为什么非要有这个通道：入网走的是 `NEHotspotConfiguration`，**一个字节都不经过蓝牙**，
  /// 而协议日志只记 BLE 收发。于是真机日志里这一段是纯黑的——两条相邻记录之间莫名其妙隔了
  /// 几十秒，看不出中间 iOS 到底说了什么、卡在哪。系统「无线局域网」里手连能成、App 里连不成
  /// 这类问题，全部的证据都在这段黑区里。
  private func wifiLog(_ msg: String) {
    emit("onWifiLog", ["msg": msg])
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

    // 超过协商 MTU 的写会被 CoreBluetooth 静默截断，设备收不满 OTA 声明的 LEN 会直接判失败。
    // 与其悄悄发出去，不如在这里报错，让上层知道帧长要跟着 MTU 走。
    let maxLen = p.maximumWriteValueLength(for: type)
    if data.count > maxLen {
      reject("WRITE_TOO_LONG",
             "单帧 \(data.count) 字节超过当前 MTU 上限 \(maxLen) 字节，会被截断", nil)
      return
    }

    // 无响应写：队列满时 writeValue 会被丢弃，必须等 canSendWriteWithoutResponse 再发。
    if type == .withoutResponse, !p.canSendWriteWithoutResponse {
      pendingWriteLock.lock()
      pendingWrite = { [weak self] in
        guard let self = self, let p = self.peripheral else {
          reject("WRITE_ERR", "等待可写期间连接已断开", nil)
          return
        }
        p.writeValue(data, for: ch, type: type)
        resolve(nil)
        _ = self
      }
      pendingWriteLock.unlock()
      // 关键：peripheralIsReady 只在发送队列「由满转空」时触发一次，且跑在 main 队列，
      // 可能恰好在上面赋值之前就已经烧掉了——那样这一帧会永远挂着，表现为 JS 卡在
      // 某个百分比不动、既不成功也不报错。这里补一次检查把丢失的唤醒补回来。
      if p.canSendWriteWithoutResponse {
        flushPendingWrite()
      }
      return
    }

    p.writeValue(data, for: ch, type: type)
    resolve(nil)
  }

  /// 取出并执行挂起的那一帧（取空即 no-op）。多处并发调用安全。
  private func flushPendingWrite() {
    pendingWriteLock.lock()
    let pending = pendingWrite
    pendingWrite = nil
    pendingWriteLock.unlock()
    pending?()
  }

  /// 带应答写：promise 直到设备 ATT 层确认收下这一帧才兑现（真正的端到端流控）。
  /// 特征不支持 .write 时明确 reject 并附上它实际有哪些属性，好让上层直接降级 + 记日志。
  @objc(writeWithResponse:characteristicUUID:base64Value:resolve:reject:)
  func writeWithResponse(_ serviceUUID: String,
                         characteristicUUID: String,
                         base64Value: String,
                         resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock) {
    let key = charKey(serviceUUID, characteristicUUID)
    guard let p = peripheral,
          let ch = characteristics[key],
          let data = Data(base64Encoded: base64Value) else {
      reject("WRITE_ERR", "特征未就绪或数据无效", nil)
      return
    }
    guard ch.properties.contains(.write) else {
      reject("WRITE_NO_ACK_SUPPORT",
             "特征 \(characteristicUUID) 不支持带应答写（当前属性：\(describeProps(ch.properties))）",
             nil)
      return
    }
    let maxLen = p.maximumWriteValueLength(for: .withResponse)
    if data.count > maxLen {
      reject("WRITE_TOO_LONG",
             "单帧 \(data.count) 字节超过带应答写上限 \(maxLen) 字节，会被截断", nil)
      return
    }
    ackWritesLock.lock()
    ackWrites.append((key: key, resolve: resolve, reject: reject))
    ackWritesLock.unlock()
    p.writeValue(data, for: ch, type: .withResponse)
  }

  // MARK: - OTA 定时发帧（整个发送循环下沉到原生）

  /// 按固定周期把整个固件切片发完，**不等任何一帧写入完成**。
  ///
  /// 为什么必须在原生做：JS 侧逐帧 `await` 过 RN 桥，真实周期 =「写入耗时 + setTimeout
  /// + 定时器超调」，实测 25~35ms，远超协议给 iOS 的 20ms，固件方据此判定发得太慢。
  /// 这里用 GCD 定时器在专属串行队列上打点，节奏与 JS 线程忙不忙彻底无关（±1ms）。
  ///
  /// 明确不做背压：`canSendWriteWithoutResponse` 为 false 时**照发不误**，只把次数记下来
  /// 随结果回传。这是调用方要的语义（宁可让控制器自己丢，也不许把节奏拖慢）；若结果里
  /// notReady 很大，说明链路根本吃不下这个速率，那是另一个问题，不要在这里偷偷变慢。
  @objc(otaSendFrames:characteristicUUID:base64Bin:frameSize:periodMs:resolve:reject:)
  func otaSendFrames(_ serviceUUID: String,
                     characteristicUUID: String,
                     base64Bin: String,
                     frameSize: Double,
                     periodMs: Double,
                     resolve: @escaping RCTPromiseResolveBlock,
                     reject: @escaping RCTPromiseRejectBlock) {
    guard let p = peripheral,
          let ch = characteristics[charKey(serviceUUID, characteristicUUID)],
          let bin = Data(base64Encoded: base64Bin) else {
      reject("OTA_ERR", "特征未就绪或固件数据无效", nil)
      return
    }
    let size = Int(frameSize)
    guard size > 0, !bin.isEmpty else {
      reject("OTA_ERR", "固件为空或帧长非法", nil)
      return
    }
    guard ch.properties.contains(.writeWithoutResponse) else {
      reject("OTA_ERR",
             "写特征不支持无应答写（当前属性：\(describeProps(ch.properties))）", nil)
      return
    }
    // 超 MTU 的帧会被 CoreBluetooth 静默截断，设备收不满 LEN 必然判失败——发前就拦。
    let maxLen = p.maximumWriteValueLength(for: .withoutResponse)
    if size > maxLen {
      reject("OTA_ERR", "单帧 \(size) 字节超过当前 MTU 上限 \(maxLen) 字节，会被截断", nil)
      return
    }

    otaLock.lock()
    if otaTimer != nil {
      otaLock.unlock()
      reject("OTA_BUSY", "已有一轮 OTA 发送在进行中", nil)
      return
    }
    otaAborted = false
    otaLock.unlock()

    let frameCount = (bin.count + size - 1) / size
    let period = max(1, Int(periodMs))
    // 每 1% 回一次进度即可：逐帧过桥回调会把 JS 线程压满，而进度条本来也只有 100 格。
    let progressStep = max(1, frameCount / 100)

    var idx = 0
    var notReady = 0
    var lastTickNs: UInt64 = 0
    var maxPeriodNs: UInt64 = 0
    let startedNs = DispatchTime.now().uptimeNanoseconds

    let timer = DispatchSource.makeTimerSource(queue: otaQueue)
    // leeway 给 0：这是设备侧硬要求的节奏，不接受系统为省电而合并唤醒。
    timer.schedule(deadline: .now(), repeating: .milliseconds(period), leeway: .nanoseconds(0))
    timer.setEventHandler { [weak self] in
      guard let self = self else { return }
      let finish: (String?, String?) -> Void = { errCode, errMsg in
        timer.cancel()
        self.otaLock.lock()
        self.otaTimer = nil
        self.otaLock.unlock()
        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - startedNs) / 1_000_000
        if let code = errCode {
          reject(code, errMsg ?? "OTA 发送中断", nil)
          return
        }
        resolve([
          "frames": idx,
          "sent": min(idx * size, bin.count),
          "total": bin.count,
          "elapsedMs": elapsedMs,
          // 定时器实测节奏：avg 是帧首到帧首的平均，max 是最坏的一次。
          "avgPeriodMs": idx > 1 ? elapsedMs / Double(idx - 1) : 0,
          "maxPeriodMs": Double(maxPeriodNs) / 1_000_000,
          // 发这一帧时 iOS 的发送队列已经满了的次数——控制器可能把它丢了。
          "notReady": notReady,
        ])
      }

      // 中止/断连的唯一跨线程信号就是这个带锁的标志（断连时 didDisconnect 会置上）。
      // 不在这里读 self.peripheral / self.characteristics：那两个由 main 队列改写，
      // 从本队列读是数据竞争；外设与特征在开始时已强引用捕获，断连后写它只是无害的 no-op。
      self.otaLock.lock()
      let aborted = self.otaAborted
      self.otaLock.unlock()
      if aborted {
        finish("OTA_ABORTED", "OTA 发送已被中止或连接已断开")
        return
      }

      let now = DispatchTime.now().uptimeNanoseconds
      if lastTickNs != 0 {
        let delta = now - lastTickNs
        if delta > maxPeriodNs { maxPeriodNs = delta }
      }
      lastTickNs = now

      let off = idx * size
      let end = min(off + size, bin.count)
      if !p.canSendWriteWithoutResponse { notReady += 1 }
      p.writeValue(bin.subdata(in: off..<end), for: ch, type: .withoutResponse)
      idx += 1

      if idx % progressStep == 0 || idx == frameCount {
        self.emit("onOtaProgress", ["sent": min(idx * size, bin.count), "total": bin.count])
      }
      if idx >= frameCount {
        finish(nil, nil)
      }
    }
    otaLock.lock()
    otaTimer = timer
    otaLock.unlock()
    timer.resume()
  }

  /// 中止正在跑的定时发帧（设备在数据阶段乱回话、用户返回、断连都会走这里）。没在跑即 no-op。
  @objc(otaAbort:reject:)
  func otaAbort(_ resolve: @escaping RCTPromiseResolveBlock,
                reject _: @escaping RCTPromiseRejectBlock) {
    otaLock.lock()
    otaAborted = true
    otaLock.unlock()
    resolve(nil)
  }

  /// 取出队首等 ACK 的那一帧并兑现。key 不匹配就原样留着（是别的特征的回调）。
  private func settleAckWrite(_ key: String, _ error: Error?) {
    ackWritesLock.lock()
    guard let idx = ackWrites.firstIndex(where: { $0.key == key }) else {
      ackWritesLock.unlock()
      return
    }
    let entry = ackWrites.remove(at: idx)
    ackWritesLock.unlock()
    if let error = error {
      entry.reject("WRITE_ERR", "设备未确认写入：\(error.localizedDescription)", error)
    } else {
      entry.resolve(nil)
    }
  }

  /// 断开时清场：这些 promise 再也等不到 ACK 了，必须放出去，否则 JS 侧永远 await 不返回。
  private func drainAckWrites(_ reason: String) {
    ackWritesLock.lock()
    let pending = ackWrites
    ackWrites.removeAll()
    ackWritesLock.unlock()
    for entry in pending {
      entry.reject("WRITE_ERR", reason, nil)
    }
  }

  private func describeProps(_ props: CBCharacteristicProperties) -> String {
    var names: [String] = []
    if props.contains(.read) { names.append("read") }
    if props.contains(.write) { names.append("write") }
    if props.contains(.writeWithoutResponse) { names.append("writeWithoutResponse") }
    if props.contains(.notify) { names.append("notify") }
    if props.contains(.indicate) { names.append("indicate") }
    return names.isEmpty ? "无" : names.joined(separator: "+")
  }

  /// 某个特征的能力。OTA 前用它决定走带应答写还是无应答写，并把结论记进日志。
  @objc(characteristicInfo:characteristicUUID:resolve:reject:)
  func characteristicInfo(_ serviceUUID: String,
                          characteristicUUID: String,
                          resolve: @escaping RCTPromiseResolveBlock,
                          reject: @escaping RCTPromiseRejectBlock) {
    guard let p = peripheral,
          let ch = characteristics[charKey(serviceUUID, characteristicUUID)] else {
      reject("NOT_CONNECTED", "特征未就绪", nil)
      return
    }
    resolve([
      "write": ch.properties.contains(.write),
      "writeWithoutResponse": ch.properties.contains(.writeWithoutResponse),
      "notify": ch.properties.contains(.notify),
      "properties": describeProps(ch.properties),
      "maxWithResponse": p.maximumWriteValueLength(for: .withResponse),
      "maxWithoutResponse": p.maximumWriteValueLength(for: .withoutResponse),
    ])
  }

  /// 当前连接下单帧可写的最大字节数（受 ATT MTU 限制）。OTA 前用它校准帧长。
  @objc(maxWriteLength:reject:)
  func maxWriteLength(_ resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    guard let p = peripheral else {
      reject("NOT_CONNECTED", "设备未连接", nil)
      return
    }
    resolve([
      "withoutResponse": p.maximumWriteValueLength(for: .withoutResponse),
      "withResponse": p.maximumWriteValueLength(for: .withResponse),
    ])
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

  /// 把 Documents 下的相对目录/文件整体搬到另一相对位置（自动建目标父目录）。
  /// 源不存在视为成功（无历史数据可搬）；若目标已存在先删掉再搬，保证 rename 不失败。
  /// 用于把旧全局 `mr20` 目录一次性迁进当前账号的 `mr20/u_<userId>`。
  @objc(moveRelativePath:toRelativePath:resolve:reject:)
  func moveRelativePath(_ fromRelativePath: String,
                        toRelativePath: String,
                        resolve: @escaping RCTPromiseResolveBlock,
                        reject: @escaping RCTPromiseRejectBlock) {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let src = docs.appendingPathComponent(fromRelativePath)
    let dst = docs.appendingPathComponent(toRelativePath)
    do {
      guard FileManager.default.fileExists(atPath: src.path) else {
        resolve(nil) // 源不存在＝无历史数据可搬，视为成功
        return
      }
      try FileManager.default.createDirectory(
        at: dst.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      if FileManager.default.fileExists(atPath: dst.path) {
        try FileManager.default.removeItem(at: dst)
      }
      try FileManager.default.moveItem(at: src, to: dst)
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

  /// NEHotspotConfigurationError 转人话，供上层日志定位。
  /// 按枚举而不是硬编码数字来判——raw value 的具体数值没必要背，也容易记错。
  private func hotspotErrorText(_ e: NSError) -> String {
    guard let code = NEHotspotConfigurationError(rawValue: e.code) else {
      return "入网失败（code \(e.code)）"
    }
    switch code {
    case .invalidWPAPassphrase:
      return "密码格式非法（WPA2 需 8~63 位 ASCII）"
    case .invalidWEPPassphrase:
      return "WEP 密码非法"
    case .invalidSSID:
      return "SSID 非法"
    case .userDenied:
      return "用户在系统弹窗上点了「取消」"
    case .pending:
      return "上一次入网请求还没结束"
    case .systemConfiguration:
      return "系统配置拒绝（可能被 MDM/描述文件限制）"
    case .joinOnceNotSupported:
      return "joinOnce 不支持"
    case .alreadyAssociated:
      return "已连接该热点"
    case .applicationIsNotInForeground:
      return "App 不在前台，系统不允许发起入网"
    case .unknown:
      return "未知错误（密码不符 / 热点未广播 都可能落到这里）"
    default:
      return "入网失败（\(code)，code \(e.code)）"
    }
  }

  /// 程序化加入设备热点。成功 resolve(true)；失败 **reject 并带上具体原因**，
  /// 由 JS 侧记进协议日志——只 resolve(false) 的话，排查时永远只能看到一句
  /// 「无法加入网络」，分不清是密码错还是热点压根没起来。
  ///
  /// ⚠️ **apply 之前必须先 removeConfiguration**。iOS 会保留此前为同一 SSID 应用过的配置，
  /// 里面很可能还存着上次试错的旧密码；不清掉就直接 apply 新密码，系统可能沿用旧配置继续失败，
  /// 表现为「密码明明改对了还是连不上」。这正是本项目卡了很久的现象之一。
  /// 轮询当前关联的 SSID，直到变成 `ssid` 或超过 `deadline`。
  ///
  /// 早先这里是**单次**检查、固定等 1.5 秒。那是个真的会把好连接弄坏的写法：iOS 从 apply
  /// 回调返回到真正关联完成（扫描 → 认证 → 关联 → DHCP）经常要 3~8 秒，1.5 秒时去问，
  /// 十有八九还报着旧网络；旧代码据此判失败，还顺手 `removeConfiguration`——**等于把一次
  /// 正在进行的关联亲手掐断**，然后告诉用户「多半是密码不符」。系统「无线局域网」里同一个
  /// 密码能连上、App 里连不上，这个写法完全解释得通。
  ///
  /// `fetchCurrent` 返回 nil 时**不下结论**：没有定位权限时它就是 nil，据此判失败会误杀。
  private func pollJoined(ssid: String,
                          deadline: Date,
                          onDone: @escaping (_ joined: Bool, _ lastSeen: String?) -> Void) {
    NEHotspotNetwork.fetchCurrent { [weak self] net in
      let current = net?.ssid
      if current == ssid {
        self?.wifiLog("已关联到「\(ssid)」")
        onDone(true, current)
        return
      }
      if Date() >= deadline {
        // 到点了还没关联上。nil 一律放行（多半只是查不到，不是没连上）。
        if let c = current {
          self?.wifiLog("等到超时，当前仍是「\(c)」，判定未能加入")
          onDone(false, c)
        } else {
          self?.wifiLog("等到超时，系统查不到当前网络（多半无定位权限）——不下结论，按已连接放行")
          onDone(true, nil)
        }
        return
      }
      self?.wifiLog("当前网络「\(current ?? "查不到")」，还不是目标，0.5s 后再看…")
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        self?.pollJoined(ssid: ssid, deadline: deadline, onDone: onDone)
      }
    }
  }

  @objc(wifiJoin:pwd:timeoutMs:resolve:reject:)
  func wifiJoin(_ ssid: String,
                pwd: String,
                timeoutMs: Double,
                resolve: @escaping RCTPromiseResolveBlock,
                reject: @escaping RCTPromiseRejectBlock) {
    // `timeoutMs` 以前是 `timeoutMs _:` —— 声明了却直接丢掉，JS 侧传的 20000 从来没起过作用。
    // 关联要几秒、DHCP 还要几秒，给多久本来就该由调用方说了算。
    let budget = timeoutMs > 0 ? timeoutMs / 1000.0 : 20.0
    wifiLog("入网开始：SSID「\(ssid)」密码 \(pwd.count) 位，最多等 \(String(format: "%.0f", budget))s")

    // WPA2 的口令必须 8~63 位 ASCII，否则 apply 直接回 invalidWPAPassphrase。
    // 提前说清楚，免得用户以为是设备的问题。
    if pwd.count < 8 || pwd.count > 63 {
      wifiLog("密码长度 \(pwd.count) 不在 WPA2 允许的 8~63 位内，iOS 一定会拒")
    }

    // 清掉同 SSID 的历史配置（含试错留下的旧密码）。没有配置时是 no-op，安全。
    NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
    wifiLog("已清掉「\(ssid)」的历史配置（避免沿用上次试错留下的旧密码）")

    let config = NEHotspotConfiguration(ssid: ssid, passphrase: pwd, isWEP: false)
    // 不持久化：App 退出/传完即释放，不会在用户的 WiFi 列表里留下这台设备。
    config.joinOnce = true
    let startedAt = Date()
    NEHotspotConfigurationManager.shared.apply(config) { [weak self] error in
      let dt = String(format: "%.1f", Date().timeIntervalSince(startedAt))
      if let e = error as NSError? {
        if e.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
          self?.wifiLog("apply 回 alreadyAssociated（\(dt)s）—— 已经在这个热点上了")
          self?.joinedSSID = ssid
          resolve(true)
          return
        }
        // 把 iOS 的原始 code 一并记下。人话文案会随版本变，code 不会，发给固件方/查文档都靠它。
        self?.wifiLog("apply 失败（\(dt)s）：\(self?.hotspotErrorText(e) ?? "")｜domain=\(e.domain) code=\(e.code)")
        reject("WIFI_JOIN_FAILED", self?.hotspotErrorText(e) ?? "入网失败", e)
        return
      }
      self?.wifiLog("apply 回调无错误（\(dt)s）—— 但这不等于连上了，继续实证当前网络")
      self?.joinedSSID = ssid
      // ⚠️ apply 回调无 error **不等于真的连上了**。密码不符时 iOS 常常照样回 nil error，
      // 只在界面弹一句「无法加入网络」——只看 error 的话我们会当成功返回 true，接着
      // 拿一个根本没关联的网络去连 192.168.200.1，最后报成莫名其妙的 socket 超时。
      //
      // 所以要实证。但**必须给足时间**（见 pollJoined 的注释），扣掉 apply 已经花掉的。
      let left = max(3.0, budget - Date().timeIntervalSince(startedAt))
      self?.pollJoined(ssid: ssid, deadline: Date().addingTimeInterval(left)) { joined, lastSeen in
        if joined {
          resolve(true)
          return
        }
        // 确实没连上才撤配置，免得残留影响下一次 apply。
        NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid)
        self?.joinedSSID = nil
        reject(
          "WIFI_JOIN_FAILED",
          "等了 \(String(format: "%.0f", left))s 系统仍未关联到「\(ssid)」" +
            "（当前是「\(lastSeen ?? "未知")」）。密码不符、热点已被设备自动关闭、" +
            "SSID 当时没在广播，都会落到这里。",
          nil)
      }
    }
  }

  /// iOS 当前替本 App 保留了哪些热点配置 + 当前关联的是哪个网络。
  /// 排查「App 里连不上、系统设置里能连上」时用：能直接看出 apply 到底有没有落地。
  @objc(wifiDiagnostics:reject:)
  func wifiDiagnostics(_ resolve: @escaping RCTPromiseResolveBlock,
                       reject _: @escaping RCTPromiseRejectBlock) {
    NEHotspotConfigurationManager.shared.getConfiguredSSIDs { ssids in
      NEHotspotNetwork.fetchCurrent { net in
        resolve([
          "configuredSSIDs": ssids,
          "currentSSID": net?.ssid as Any,
          "joinedSSID": self.joinedSSID as Any,
        ])
      }
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
    // 断开时若还挂着一帧，它的 promise 没人再兑现——必须放出去 reject（闭包里 peripheral
    // 已为 nil，会走「等待可写期间连接已断开」），否则 JS 侧永远 await 不返回。
    flushPendingWrite()
    drainAckWrites("等待设备确认写入期间连接已断开")
    // 定时发帧不看链路状态（它按点发、不等回执），断连后必须显式叫停，
    // 否则它会对着 nil peripheral 空转到把 3536 帧「发」完。
    otaLock.lock()
    otaAborted = true
    otaLock.unlock()
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
                  didWriteValueFor characteristic: CBCharacteristic,
                  error: Error?) {
    if let error = error {
      emit("onError", ["code": "WRITE", "message": error.localizedDescription])
    }
    // 带应答写在这里才算完成。service 可能为 nil（外设已释放），那样也无从匹配，直接跳过。
    if let svc = characteristic.service {
      settleAckWrite(charKey(svc.uuid.uuidString, characteristic.uuid.uuidString), error)
    }
  }

  /// 无响应写队列腾出空间：把 writeNoResponse 挂起的那一帧补发出去。
  func peripheralIsReady(toSendWriteWithoutResponse _: CBPeripheral) {
    flushPendingWrite()
  }
}
