package com.ringmemoryapp.audiorecorder

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AudioRecorderPackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == AudioRecorderModule.NAME) AudioRecorderModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                AudioRecorderModule.NAME to ReactModuleInfo(
                    AudioRecorderModule.NAME,
                    AudioRecorderModule::class.java.name,
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
