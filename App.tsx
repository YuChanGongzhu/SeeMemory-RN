/**
 * RingMemoryApp - Smart Ring Memory Assistant
 * Three Theme Versions: Neon Horizon, Sunset Grove, Shiguang
 */

import React from 'react';
import {ActivityIndicator, StatusBar, Text, View, TouchableOpacity, StyleSheet} from 'react-native';
import {NavigationContainer, type Theme as NavigationTheme} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider, useTheme} from './src/theme/ThemeProvider';
import {AuthProvider, useAuth} from './src/auth/AuthContext';
import {CaptureProvider, useCapturePanel} from './src/hooks/useCapturePanel';
import {LoginScreen} from './src/screens/LoginScreen';
import {NowScreen} from './src/screens/NowScreen';
import {ChatScreen} from './src/screens/ChatScreen';
import {MemoriesScreen} from './src/screens/MemoriesScreen';
import {MeScreen} from './src/screens/MeScreen';
import {CapturePanel} from './src/components/CapturePanel';
import {SunIcon, ChatIcon, MemoryIcon, UserIcon, PlusIcon} from './src/components/Icons';

const Tab = createBottomTabNavigator();

function TabIcon({
  name,
  focused,
  activeColor,
  inactiveColor,
  mode,
}: {
  name: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  mode: string;
}) {
  const size = focused ? 23 : 21;
  const color = focused ? activeColor : inactiveColor;
  const strokeWidth = focused ? 2 : 1.7;

  if (mode === 'shiguang') {
    const icons: Record<string, React.ReactNode> = {
      'Now': <SunIcon size={size} color={color} strokeWidth={strokeWidth} />,
      'Chat': <ChatIcon size={size} color={color} strokeWidth={strokeWidth} />,
      'Memories': <MemoryIcon size={size} color={color} strokeWidth={strokeWidth} />,
      'Me': <UserIcon size={size} color={color} strokeWidth={strokeWidth} />,
    };
    return <View style={{alignItems: 'center', justifyContent: 'center'}}>{icons[name]}</View>;
  }

  // Neon theme icons
  const neonIcons: Record<string, string> = {
    'Now': '◈',
    'Chat': '◇',
    'Memories': '◆',
    'Me': '◎',
  };
  // Warm theme icons
  const warmIcons: Record<string, string> = {
    'Now': '☀️',
    'Chat': '💬',
    'Memories': '🌳',
    'Me': '⚙️',
  };

  const icons = mode === 'neon' ? neonIcons : warmIcons;

  return (
    <View style={{alignItems: 'center', justifyContent: 'center'}}>
      <Text
        style={{
          fontSize: size,
          color,
          opacity: focused ? 1 : 0.9,
          textShadowColor: focused ? activeColor : 'transparent',
          textShadowRadius: focused ? 8 : 0,
        }}>
        {icons[name]}
      </Text>
    </View>
  );
}

function AppNavigator() {
  const {theme} = useTheme();

  const navTheme: NavigationTheme = {
    dark: theme.mode !== 'warm' && theme.mode !== 'shiguang',
    colors: {
      primary: theme.colors.accent,
      background: theme.colors.bg,
      card: theme.colors.bgSecondary,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.accent,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '900' },
    },
  };

  const {openCapture, captureOpen, closeCapture} = useCapturePanel();

  const getTabConfig = () => {
    if (theme.mode === 'shiguang') {
      return {
        tabs: [
          {name: 'Now', label: '此刻'},
          {name: 'Chat', label: '对话'},
          {name: 'Memories', label: '记忆'},
          {name: 'Me', label: '我的'},
        ],
        hasFab: true,
      };
    }
    if (theme.mode === 'neon') {
      return {
        tabs: [
          {name: 'Now', label: '此刻'},
          {name: 'Chat', label: '对话'},
          {name: 'Memories', label: '记忆'},
          {name: 'Me', label: '我的'},
        ],
        hasFab: false,
      };
    }
    // warm
    return {
      tabs: [
        {name: 'Now', label: '此刻'},
        {name: 'Chat', label: '对话'},
        {name: 'Memories', label: '记忆'},
        {name: 'Me', label: '我的'},
      ],
      hasFab: false,
    };
  };

  const config = getTabConfig();

  return (
    <>
      <StatusBar
        barStyle={theme.mode === 'warm' || theme.mode === 'shiguang' ? 'dark-content' : 'light-content'}
        backgroundColor={theme.colors.bg}
      />
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: theme.mode === 'shiguang' ? 'rgba(243, 241, 233, 0.88)' : theme.colors.bgSecondary,
              borderTopColor: theme.mode === 'shiguang' ? '#E6E1D2' : theme.colors.border,
              borderTopWidth: 1,
              paddingBottom: 8,
              paddingTop: 8,
              height: theme.mode === 'shiguang' ? 72 : 60,
            },
            tabBarActiveTintColor: theme.colors.accent,
            tabBarInactiveTintColor: theme.colors.textMuted,
            tabBarLabelStyle: {
              fontSize: theme.mode === 'shiguang' ? 10.5 : 11,
              fontWeight: theme.mode === 'shiguang' ? '500' : '400',
              letterSpacing: theme.mode === 'shiguang' ? 0.5 : 0,
            },
          }}>
          {config.tabs.slice(0, 2).map((tab) => (
            <Tab.Screen
              key={tab.name}
              name={tab.name}
              component={
                tab.name === 'Now' ? NowScreen :
                tab.name === 'Chat' ? ChatScreen :
                tab.name === 'Memories' ? MemoriesScreen :
                MeScreen
              }
              options={{
                tabBarLabel: tab.label,
                tabBarIcon: ({focused}) => (
                  <TabIcon
                    name={tab.name}
                    focused={focused}
                    activeColor={theme.colors.accent}
                    inactiveColor={theme.colors.textMuted}
                    mode={theme.mode}
                  />
                ),
              }}
            />
          ))}
          {config.hasFab && (
            <Tab.Screen
              name="Capture"
              component={NowScreen}
              options={{
                tabBarLabel: () => null,
                tabBarIcon: () => (
                  <View style={[localStyles.fab, {
                    width: 58,
                    height: 58,
                    borderRadius: 29,
                    marginTop: -26,
                    backgroundColor: theme.colors.accent,
                    borderWidth: 4,
                    borderColor: '#F3F1E9',
                    shadowColor: '#3F8A82',
                    shadowOpacity: 0.55,
                    shadowRadius: 12,
                    elevation: 8,
                  }]}>
                    <PlusIcon size={26} color="#FFFFFF" strokeWidth={2.3} />
                  </View>
                ),
              }}
              listeners={() => ({
                tabPress: (e) => {
                  e.preventDefault();
                  openCapture();
                },
              })}
            />
          )}
          {config.tabs.slice(2).map((tab) => (
            <Tab.Screen
              key={tab.name}
              name={tab.name}
              component={
                tab.name === 'Now' ? NowScreen :
                tab.name === 'Chat' ? ChatScreen :
                tab.name === 'Memories' ? MemoriesScreen :
                MeScreen
              }
              options={{
                tabBarLabel: tab.label,
                tabBarIcon: ({focused}) => (
                  <TabIcon
                    name={tab.name}
                    focused={focused}
                    activeColor={theme.colors.accent}
                    inactiveColor={theme.colors.textMuted}
                    mode={theme.mode}
                  />
                ),
              }}
            />
          ))}
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

function AuthGate() {
  const {theme} = useTheme();
  const {isHydrated, authToken} = useAuth();

  if (!isHydrated) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}>
        <StatusBar
          barStyle={theme.mode === 'warm' || theme.mode === 'shiguang' ? 'dark-content' : 'light-content'}
          backgroundColor={theme.colors.bg}
        />
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  if (!authToken) {
    return (
      <>
        <StatusBar
          barStyle={theme.mode === 'warm' || theme.mode === 'shiguang' ? 'dark-content' : 'light-content'}
          backgroundColor={theme.colors.bg}
        />
        <LoginScreen />
      </>
    );
  }

  return (
    <>
      <AppNavigator />
      <RootCapturePanel />
    </>
  );
}

function RootCapturePanel() {
  const {captureOpen, closeCapture} = useCapturePanel();
  return <CapturePanel visible={captureOpen} onClose={closeCapture} />;
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <CaptureProvider>
            <AuthGate />
          </CaptureProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const localStyles = StyleSheet.create({
  fab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;
