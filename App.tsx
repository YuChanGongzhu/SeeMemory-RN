/**
 * RingMemoryApp - Smart Ring Memory Assistant
 */

import React from 'react';
import {StatusBar, Text} from 'react-native';
import {DarkTheme, NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {MemoryScreen} from './src/screens/MemoryScreen';
import {DevicesScreen} from './src/screens/DevicesScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#00D4AA',
    background: '#0D0D0D',
    card: '#1A1A1A',
    text: '#E5E5E5',
    border: '#333333',
    notification: '#00D4AA',
  },
};

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      <NavigationContainer theme={navigationTheme}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: '#1A1A1A',
              borderTopColor: '#333',
              borderTopWidth: 1,
              paddingBottom: 8,
              paddingTop: 8,
              height: 60,
            },
            tabBarActiveTintColor: '#00D4AA',
            tabBarInactiveTintColor: '#666',
            tabBarLabelStyle: {
              fontSize: 11,
            },
          }}>
          <Tab.Screen
            name="Memory"
            component={MemoryScreen}
            options={{
              tabBarLabel: 'Memory',
              tabBarIcon: ({color}) => (
                <TabIcon emoji="🧠" color={color} />
              ),
            }}
          />
          <Tab.Screen
            name="Devices"
            component={DevicesScreen}
            options={{
              tabBarLabel: 'Devices',
              tabBarIcon: ({color}) => (
                <TabIcon emoji="📱" color={color} />
              ),
            }}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{
              tabBarLabel: 'Settings',
              tabBarIcon: ({color}) => (
                <TabIcon emoji="⚙️" color={color} />
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

function TabIcon({emoji}: {emoji: string; color: string}) {
  return (
    <Text style={{fontSize: 18}}>{emoji}</Text>
  );
}

export default App;
