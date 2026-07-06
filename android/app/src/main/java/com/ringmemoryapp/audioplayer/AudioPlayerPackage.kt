package com.ringmemoryapp.audioplayer

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AudioPlayerPackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == AudioPlayerModule.NAME) AudioPlayerModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                AudioPlayerModule.NAME to ReactModuleInfo(
                    AudioPlayerModule.NAME,
                    AudioPlayerModule::class.java.name,
                    false,
                    false,
                    true,
                    false,
                    true
                )
            )
        }
    }
}
