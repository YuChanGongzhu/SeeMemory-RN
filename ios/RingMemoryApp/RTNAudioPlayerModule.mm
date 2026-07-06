#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RTNAudioPlayerModule, NSObject)

RCT_EXTERN_METHOD(playAudioFile:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopAudioPlayback:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
