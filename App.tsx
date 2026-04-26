/**
 * RingMemoryApp - Smart Ring Memory Assistant
 * Three Theme Versions: Neon Horizon, Sunset Grove, Obsidian Gold
 */

import React from 'react';
import {StatusBar, Text, View} from 'react-native';
import {NavigationContainer, type Theme as NavigationTheme} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider, useTheme} from './src/theme/ThemeProvider';
import {MemoryScreen} from './src/theme/MemoryScreen';
import {DevicesScreen} from './src/theme/DevicesScreen';
import {SettingsScreen} from './src/theme/SettingsScreen';

const Tab = createBottomTabNavigator();

function TabIcon({
  glyph,
  focused,
  activeColor,
  inactiveColor,
}: {
  glyph: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <View style={{alignItems: 'center', justifyContent: 'center'}}>
      <Text
        style={{
          fontSize: focused ? 22 : 20,
          color: focused ? activeColor : inactiveColor,
          opacity: focused ? 1 : 0.9,
          textShadowColor: focused ? activeColor : 'transparent',
          textShadowRadius: focused ? 8 : 0,
        }}>
        {glyph}
      </Text>
    </View>
  );
}

function AppNavigator() {
  const {theme} = useTheme();

  const navTheme: NavigationTheme = {
    dark: theme.mode !== 'warm',
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

  const getTabEmojis = () => {
    if (theme.mode === 'neon') return {memory: '◈', devices: '⬡', settings: '✦'};
    if (theme.mode === 'warm') return {memory: '🌿', devices: '📱', settings: '⚙️'};
    return {memory: '◆', devices: '◎', settings: '◈'};
  };

  const emojis = getTabEmojis();

  return (
    <>
      <StatusBar
        barStyle={theme.mode === 'warm' ? 'dark-content' : 'light-content'}
        backgroundColor={theme.colors.bg}
      />
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: theme.colors.bgSecondary,
              borderTopColor: theme.colors.border,
              borderTopWidth: 1,
              paddingBottom: 8,
              paddingTop: 8,
              height: 60,
            },
            tabBarActiveTintColor: theme.colors.accent,
            tabBarInactiveTintColor: theme.colors.textSecondary,
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '400',
              letterSpacing: 0,
              ...({}),
            },
          }}>
          <Tab.Screen
            name="Memory"
            component={MemoryScreen}
            options={{
              tabBarLabel: '记忆',
              tabBarIcon: ({focused}) => (
                <TabIcon
                  glyph={emojis.memory}
                  focused={focused}
                  activeColor={theme.colors.accent}
                  inactiveColor={theme.colors.textSecondary}
                />
              ),
            }}
          />
          <Tab.Screen
            name="Devices"
            component={DevicesScreen}
            options={{
              tabBarLabel: '设备',
              tabBarIcon: ({focused}) => (
                <TabIcon
                  glyph={emojis.devices}
                  focused={focused}
                  activeColor={theme.colors.accent}
                  inactiveColor={theme.colors.textSecondary}
                />
              ),
            }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              tabBarLabel: '设置',
              tabBarIcon: ({focused}) => (
                <TabIcon
                  glyph={emojis.settings}
                  focused={focused}
                  activeColor={theme.colors.accent}
                  inactiveColor={theme.colors.textSecondary}
                />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default App;
