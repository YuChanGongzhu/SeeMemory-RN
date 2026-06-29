#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <ReactCommon/RCTTurboModule.h>

#if __has_include("RingMemoryAppSpec/RingMemoryAppSpec.h")
#import "RingMemoryAppSpec/RingMemoryAppSpec.h"
#elif __has_include(<RingMemoryAppSpec/RingMemoryAppSpec.h>)
#import <RingMemoryAppSpec/RingMemoryAppSpec.h>
#endif

using namespace facebook::react;

@interface RCT_EXTERN_MODULE(RTNMr20Module, RCTEventEmitter)

RCT_EXTERN_METHOD(addListener:(NSString *)eventName)
RCT_EXTERN_METHOD(removeListeners:(double)count)

RCT_EXTERN_METHOD(getBleState:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startScan:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopScan:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(connect:(NSString *)deviceId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(disconnect:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(writeNoResponse:(NSString *)serviceUUID
                  characteristicUUID:(NSString *)characteristicUUID
                  base64Value:(NSString *)base64Value
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(monitor:(NSString *)serviceUUID
                  characteristicUUID:(NSString *)characteristicUUID
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(writeBase64File:(NSString *)relativePath
                  base64Value:(NSString *)base64Value
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteRelativePath:(NSString *)relativePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

#if __has_include("RingMemoryAppSpec/RingMemoryAppSpec.h") || __has_include(<RingMemoryAppSpec/RingMemoryAppSpec.h>)
@interface RTNMr20Module (TurboModule) <NativeMr20ModuleSpec>
@end

@implementation RTNMr20Module (TurboModule)

- (std::shared_ptr<TurboModule>)getTurboModule:(const ObjCTurboModule::InitParams &)params {
  return std::make_shared<NativeMr20ModuleSpecJSI>(params);
}

@end
#endif
