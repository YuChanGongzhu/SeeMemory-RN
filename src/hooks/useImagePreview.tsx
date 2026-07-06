import React, {createContext, useContext, useState, useCallback} from 'react';
import {
  View, Image, Modal, ScrollView, TouchableOpacity, ActivityIndicator,
  Dimensions, StyleSheet, StatusBar,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {X} from 'lucide-react-native';

interface ImagePreviewContextType {
  /** 打开全屏图片预览（支持双指缩放）。 */
  preview: (uri: string) => void;
}

const ImagePreviewContext = createContext<ImagePreviewContextType>({preview: () => {}});

/**
 * 全屏图片预览（灯箱）。任意位置调用 useImagePreview().preview(uri) 即可弹出，
 * iOS 用 ScrollView 的原生 pinch-zoom 支持双指放大，点背景 / 关闭按钮退出。
 */
export function ImagePreviewProvider({children}: {children: React.ReactNode}) {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const {width, height} = Dimensions.get('window');

  const preview = useCallback((next: string) => {
    if (!next) return;
    setLoading(true);
    setUri(next);
  }, []);

  const close = useCallback(() => setUri(null), []);

  return (
    <ImagePreviewContext.Provider value={{preview}}>
      {children}
      <Modal visible={!!uri} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.root}>
          <StatusBar barStyle="light-content" />
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={styles.scrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}>
            <TouchableOpacity activeOpacity={1} onPress={close}>
              {uri ? (
                <Image
                  source={{uri}}
                  style={{width, height}}
                  resizeMode="contain"
                  onLoadEnd={() => setLoading(false)}
                />
              ) : null}
            </TouchableOpacity>
          </ScrollView>
          {loading ? (
            <ActivityIndicator style={StyleSheet.absoluteFill} color="#fff" size="large" />
          ) : null}
          <TouchableOpacity style={[styles.close, {top: insets.top + 12}]} onPress={close}>
            <X size={22} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      </Modal>
    </ImagePreviewContext.Provider>
  );
}

export const useImagePreview = () => useContext(ImagePreviewContext);

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: 'rgba(0,0,0,0.96)'},
  scrollContent: {flexGrow: 1, alignItems: 'center', justifyContent: 'center'},
  close: {
    position: 'absolute', right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
});
