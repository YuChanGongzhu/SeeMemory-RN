package com.ringmemoryapp.imagepicker

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class ImagePickerPackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return if (name == ImagePickerModule.NAME) ImagePickerModule(reactContext) else null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                ImagePickerModule.NAME to ReactModuleInfo(
                    ImagePickerModule.NAME,
                    ImagePickerModule::class.java.name,
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
