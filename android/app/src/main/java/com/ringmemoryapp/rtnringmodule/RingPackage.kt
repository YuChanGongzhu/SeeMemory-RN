//
//  RingPackage.kt
//  RingMemoryApp
//
//  React Native package for RingModule
//

package com.ringmemoryapp.rtnringmodule

import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.TurboReactPackage

class RingPackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == RingModule.NAME) RingModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                RingModule.NAME to ReactModuleInfo(
                    RingModule.NAME,
                    RingModule::class.java.name,
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
