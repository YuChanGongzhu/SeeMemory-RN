#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SaveImageModule, NSObject)

RCT_EXTERN_METHOD(saveBase64ToCameraRoll:(NSString *)base64Png
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
