/**
 * SiMemory - AI Memory Assistant
 * Faithful RN port of the app-prototype UI (single light iOS-style theme,
 * hub-and-spoke navigation: Home hub + FAB capsule + global drawer).
 */

import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StatusBar, View, Modal, StyleSheet} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AuthProvider, useAuth} from './src/auth/AuthContext';
import {AppDrawerProvider} from './src/hooks/useAppDrawer';
import {LoginPromptProvider, useLoginPrompt} from './src/hooks/useWriteGate';
import {NavProvider} from './src/navigation/nav';
import {RootView} from './src/navigation/Root';
import {Mr20Provider} from './src/hooks/useMr20';
import {ImagePreviewProvider} from './src/hooks/useImagePreview';
import {CreateSummaryProvider} from './src/hooks/useCreateSummary';
import {AppDrawer} from './src/components/AppDrawer';
import {LoginScreen} from './src/screens/LoginScreen';
import {ConsentScreen} from './src/screens/ConsentScreen';
import {getPrivacyConsent, savePrivacyConsent} from './src/services/storage';
import {colors} from './src/design/tokens';

/** Login overlay shown when a guest triggers a write action. */
function LoginPromptOverlay() {
  const {visible, hide} = useLoginPrompt();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={hide} presentationStyle="fullScreen">
      <LoginScreen prompt onClose={hide} />
    </Modal>
  );
}

function AuthGate() {
  const {isHydrated, authToken} = useAuth();
  // 隐私与 AI 处理告知先于一切：游客态同样能录音上传，所以这道门必须挡在登录之前。
  const [consented, setConsented] = useState<boolean | null>(null);

  useEffect(() => {
    getPrivacyConsent()
      .then(setConsented)
      // 读本地存储失败时按"未同意"处理：宁可多问一次，也不能在未取得同意的情况下放行。
      .catch(() => setConsented(false));
  }, []);

  if (!isHydrated || consented === null) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bgApp} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!consented) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bgApp} />
        <ConsentScreen
          onAgree={() => {
            setConsented(true);
            void savePrivacyConsent();
          }}
        />
      </>
    );
  }

  if (!authToken) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bgApp} />
        <LoginScreen />
      </>
    );
  }

  return (
    <Mr20Provider>
      <NavProvider>
        <ImagePreviewProvider>
          <CreateSummaryProvider>
            <StatusBar barStyle="dark-content" backgroundColor={colors.bgApp} />
            <View style={styles.root}>
              <RootView />
            </View>
            <AppDrawer />
            <LoginPromptOverlay />
          </CreateSummaryProvider>
        </ImagePreviewProvider>
      </NavProvider>
    </Mr20Provider>
  );
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppDrawerProvider>
          <LoginPromptProvider>
            <AuthGate />
          </LoginPromptProvider>
        </AppDrawerProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  splash: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgApp},
});

export default App;
