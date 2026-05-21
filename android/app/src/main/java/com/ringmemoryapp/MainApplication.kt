package com.ringmemoryapp

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.ringmemoryapp.imagepicker.ImagePickerPackage
import com.lm.sdk.LmAPI
import com.ringmemoryapp.rtnringmodule.RingPackage
import com.ringmemoryapp.rokid.RokidPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(RingPackage())
          add(RokidPackage())
          add(ImagePickerPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    LmAPI.init(this)
    loadReactNative(this)
  }
}
