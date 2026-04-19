#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ImagePickerModule, NSObject)

RCT_EXTERN_METHOD(pickImage:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

@end
