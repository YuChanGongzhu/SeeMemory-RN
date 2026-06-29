Pod::Spec.new do |s|
  s.name         = "RTNMr20Module"
  s.version      = "1.0.0"
  s.summary      = "MR20 记忆粒 BLE TurboModule"
  s.description  = "Native CoreBluetooth TurboModule for the MR20 (记忆粒) wearable recorder. Independent of the ring SDK."
  s.homepage     = "https://seemem.com"
  s.license      = { :type => "MIT" }
  s.author       = { "SeeMemory" => "dev@seemem.com" }
  s.platform     = :ios, "13.0"
  s.source       = { :path => "." }

  # Source files
  s.source_files = "RTNMr20Module.{mm,swift}"

  # React Native dependencies (与 RTNRingModule 同一套，可正常编译)
  s.dependency "React-Core"
  s.dependency "React-RCTFabric"
  s.dependency "React-Codegen"
  s.dependency "ReactCommon/turbomodule/core"

  s.frameworks = "CoreBluetooth", "Foundation"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES"
  }
end
