#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <ReactCommon/RCTTurboModule.h>

#if __has_include("RingMemoryAppSpec/RingMemoryAppSpec.h")
#import "RingMemoryAppSpec/RingMemoryAppSpec.h"
#elif __has_include(<RingMemoryAppSpec/RingMemoryAppSpec.h>)
#import <RingMemoryAppSpec/RingMemoryAppSpec.h>
#endif

using namespace facebook::react;

@interface RCT_EXTERN_MODULE(RTNRingModule, RCTEventEmitter)

RCT_EXTERN_METHOD(addListener:(NSString *)eventName)
RCT_EXTERN_METHOD(removeListeners:(double)count)

RCT_EXTERN_METHOD(startScan:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopScan:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(connectDevice:(NSString *)deviceId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(disconnectDevice:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getDeviceStatus:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startCapture:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopCapture:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isCapturing:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getSavedAudioSegments:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(playAudioFile:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopAudioPlayback:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkForFirmwareUpdate:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(updateFirmware:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

#if __has_include("RingMemoryAppSpec/RingMemoryAppSpec.h") || __has_include(<RingMemoryAppSpec/RingMemoryAppSpec.h>)
@interface RTNRingModule (TurboModule) <NativeRingModuleSpec>
@end

@implementation RTNRingModule (TurboModule)

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params {
  return std::make_shared<NativeRingModuleSpecJSI>(params);
}

@end
#endif
