Pod::Spec.new do |s|
  s.name         = "RTNRokidModule"
  s.version      = "1.0.0"
  s.summary      = "React Native bridge for Rokid CXR-L SDK"
  s.description  = "Native module for Rokid CXR-L auth, scene, audio, and photo capabilities"
  s.homepage     = "https://custom.rokid.com"
  s.license      = { :type => "MIT" }
  s.author       = { "SeeMemory" => "dev@seememory.local" }
  s.platform     = :ios, "16.0"
  s.source       = { :path => "." }

  s.source_files = "RTNRokidModule.{mm,swift}"

  s.dependency "React-Core"
  s.dependency "RGCxrClient"
  s.dependency "RGCoreKit"

  s.frameworks = "Foundation", "UIKit"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES"
  }
end
