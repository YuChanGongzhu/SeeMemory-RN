#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <ReactCommon/RCTTurboModule.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#if __has_include("RingMemoryAppSpec/RingMemoryAppSpec.h")
#import "RingMemoryAppSpec/RingMemoryAppSpec.h"
#elif __has_include(<RingMemoryAppSpec/RingMemoryAppSpec.h>)
#import <RingMemoryAppSpec/RingMemoryAppSpec.h>
#endif

using namespace facebook::react;

extern "C" {
#include "vendor/rnnoise/src/rnnoise.h"

#include "vendor/rnnoise/src/rnn_data.c"
#include "vendor/rnnoise/src/rnn.c"
#include "vendor/rnnoise/src/pitch.c"
#include "vendor/rnnoise/src/kiss_fft.c"
#include "vendor/rnnoise/src/celt_lpc.c"
#include "vendor/rnnoise/src/denoise.c"
}

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
RCT_EXTERN_METHOD(startCapturePCM:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopCapture:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isCapturing:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getSavedAudioSegments:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(denoiseAudioFile:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
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

extern "C" int32_t RNNoiseDenoisePCM16Mono8k(const int16_t *input,
                                               int32_t sampleCount,
                                               int16_t *output) {
  if (input == nullptr || output == nullptr || sampleCount <= 0) {
    return 0;
  }

  constexpr int kUpsampleFactor = 6;
  constexpr int kFrameSize48k = 480;

  std::vector<float> input8k(static_cast<size_t>(sampleCount));
  for (int32_t i = 0; i < sampleCount; ++i) {
    input8k[static_cast<size_t>(i)] = static_cast<float>(input[i]);
  }

  std::vector<float> up48k;
  if (sampleCount == 1) {
    up48k.assign(kUpsampleFactor, input8k[0]);
  } else {
    up48k.reserve(static_cast<size_t>(sampleCount) * kUpsampleFactor);
    for (int32_t i = 0; i + 1 < sampleCount; ++i) {
      const float a = input8k[static_cast<size_t>(i)];
      const float b = input8k[static_cast<size_t>(i + 1)];
      for (int k = 0; k < kUpsampleFactor; ++k) {
        const float t = static_cast<float>(k) / static_cast<float>(kUpsampleFactor);
        up48k.push_back(a + (b - a) * t);
      }
    }
    for (int k = 0; k < kUpsampleFactor; ++k) {
      up48k.push_back(input8k.back());
    }
  }

  DenoiseState *state = rnnoise_create();
  if (state == nullptr) {
    return 0;
  }

  std::vector<float> denoised48k;
  denoised48k.reserve(up48k.size());
  std::vector<float> inFrame(kFrameSize48k, 0.0f);
  std::vector<float> outFrame(kFrameSize48k, 0.0f);

  size_t offset = 0;
  while (offset < up48k.size()) {
    const size_t remaining = up48k.size() - offset;
    const size_t copyCount = std::min(static_cast<size_t>(kFrameSize48k), remaining);
    std::fill(inFrame.begin(), inFrame.end(), 0.0f);
    std::copy_n(up48k.begin() + static_cast<std::ptrdiff_t>(offset), copyCount, inFrame.begin());

    rnnoise_process_frame(state, outFrame.data(), inFrame.data());
    denoised48k.insert(denoised48k.end(), outFrame.begin(), outFrame.begin() + static_cast<std::ptrdiff_t>(copyCount));
    offset += copyCount;
  }

  rnnoise_destroy(state);

  if (denoised48k.empty()) {
    return 0;
  }

  for (int32_t i = 0; i < sampleCount; ++i) {
    const size_t base = static_cast<size_t>(i) * kUpsampleFactor;
    float acc = 0.0f;
    int cnt = 0;
    for (int k = 0; k < kUpsampleFactor; ++k) {
      const size_t idx = base + static_cast<size_t>(k);
      if (idx < denoised48k.size()) {
        acc += denoised48k[idx];
        ++cnt;
      }
    }

    float value = cnt > 0 ? acc / static_cast<float>(cnt) : 0.0f;
    value = std::max(-32768.0f, std::min(32767.0f, value));
    output[i] = static_cast<int16_t>(std::lrintf(value));
  }

  return sampleCount;
}
