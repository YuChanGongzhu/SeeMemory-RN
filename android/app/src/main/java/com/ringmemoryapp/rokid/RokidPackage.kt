package com.ringmemoryapp.rokid

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class RokidPackage : TurboReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == RokidModule.NAME) RokidModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                RokidModule.NAME to ReactModuleInfo(
                    RokidModule.NAME,
                    RokidModule::class.java.name,
                    false,
                    false,
                    true,
                    false,
                    false
                )
            )
        }
    }
}
