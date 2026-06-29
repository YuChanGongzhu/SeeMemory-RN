import React from 'react';
import {View, StyleSheet} from 'react-native';
import {colors} from '../design/tokens';
import {useNav} from './nav';
import {HomeHub} from '../screens/HomeHub';
import {ChatPage} from '../screens/ChatPage';
import {EditorPage} from '../screens/EditorPage';
import {MemoryDetail} from '../screens/MemoryDetail';
import {StatusDetail} from '../screens/StatusDetail';
import {ArchivePage} from '../screens/ArchivePage';
import {TopicSummaryDetail} from '../screens/TopicSummaryDetail';
import {HardwarePage} from '../screens/HardwarePage';
import {TodoPage} from '../screens/TodoPage';
import {MembershipPage} from '../screens/MembershipPage';
import {PowerStorePage} from '../screens/PowerStorePage';
import {ProfilePage} from '../screens/ProfilePage';
import {TimelinePage} from '../screens/TimelinePage';

/** Renders the top frame of the nav stack (hub-and-spoke, no tab bar). */
export function RootView() {
  const {current} = useNav();

  switch (current.name) {
    case 'home':
      return <HomeHub />;
    case 'chat':
      return <ChatPage />;
    case 'editor':
      return <EditorPage />;
    case 'memoryDetail':
      return <MemoryDetail />;
    case 'dailyStatus':
      return <StatusDetail />;
    case 'historical':
      return <StatusDetail dark />;
    case 'archive':
      return <ArchivePage />;
    case 'topicSummary':
      return <TopicSummaryDetail />;
    case 'hardware':
      return <HardwarePage />;
    case 'todo':
      return <TodoPage />;
    case 'membership':
      return <MembershipPage />;
    case 'powerStore':
      return <PowerStorePage />;
    case 'profile':
      return <ProfilePage />;
    case 'timeline':
      return <TimelinePage />;
    default:
      return <View style={styles.fallback} />;
  }
}

const styles = StyleSheet.create({
  fallback: {flex: 1, backgroundColor: colors.bgApp},
});
