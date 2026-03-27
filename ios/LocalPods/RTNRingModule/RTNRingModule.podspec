Pod::Spec.new do |s|
  s.name         = "RTNRingModule"
  s.version      = "1.0.0"
  s.summary      = "React Native TurboModule for BCLRingSDK smart ring integration"
  s.description  = "Native module for connecting to BraveChip ChipletRing smart ring via BLE"
  s.homepage     = "https://github.com/bravechip/ChipletRing-APPSDK"
  s.license      = { :type => "MIT", :file => "LICENSE" }
  s.author       = { "BraveChip" => "xiaojian.cui@bravechip.com" }
  s.platform     = :ios, "13.0"
  s.source       = { :path => "." }

  # Source files
  s.source_files = "RTNRingModule.{mm,swift}"

  # Vendored BCLRingSDK
  s.vendored_frameworks = "BCLRingSDK.xcframework"

  # React Native dependencies
  s.dependency "React-Core"
  s.dependency "React-RCTFabric"
  s.dependency "React-Codegen"
  s.dependency "ReactCommon/turbomodule/core"

  # BCLRingSDK transitive dependencies (aligned with BraveChip iOS demo)
  s.dependency "Foil", "~> 5.1.2"
  s.dependency "NordicDFU"
  s.dependency "RxSwift", "~> 6.9.0"
  s.dependency "RxCocoa", "~> 6.9.0"
  s.dependency "SwiftDate"
  s.dependency "SwiftyBeaver", "1.9.5"
  s.dependency "Zip"

  s.frameworks = "CoreBluetooth", "Foundation"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES"
  }
end
