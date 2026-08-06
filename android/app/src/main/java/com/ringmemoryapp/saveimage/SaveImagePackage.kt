package com.ringmemoryapp.saveimage

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SaveImagePackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == SaveImageModule.NAME) SaveImageModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                SaveImageModule.NAME to ReactModuleInfo(
                    SaveImageModule.NAME,
                    SaveImageModule::class.java.name,
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
