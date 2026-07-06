/**
 * imemory - AI Memory Assistant
 * Faithful RN port of the app-prototype UI (single light iOS-style theme,
 * hub-and-spoke navigation: Home hub + FAB capsule + global drawer).
 */

import React from 'react';
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

  if (!isHydrated) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bgApp} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
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
