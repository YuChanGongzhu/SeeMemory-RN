import React from 'react';
import {View, StyleSheet} from 'react-native';
import {colors} from '../design/tokens';
import {useNav, FrameProvider, type Frame} from './nav';
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
import {PrivacyAIPage} from '../screens/PrivacyAIPage';

function renderScreen(name: Frame['name']) {
  switch (name) {
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
    case 'privacyAi':
      return <PrivacyAIPage />;
    case 'timeline':
      return <TimelinePage />;
    default:
      return <View style={styles.fallback} />;
  }
}

/**
 * Hub-and-spoke stack. The whole stack stays mounted — lower frames are just
 * hidden (display:none) so their scroll position and local state survive a
 * push/pop round-trip (返回卡片列表不再跳回顶部). Each frame is wrapped in a
 * FrameProvider so its screen reads its own params, not the top frame's.
 */
export function RootView() {
  const {stack} = useNav();
  const topIndex = stack.length - 1;

  return (
    <View style={styles.stack}>
      {stack.map((frame, i) => (
        <View
          key={frame.key ?? `${frame.name}-${i}`}
          style={[styles.frame, i === topIndex ? null : styles.hidden]}
          pointerEvents={i === topIndex ? 'auto' : 'none'}
          aria-hidden={i !== topIndex}>
          <FrameProvider frame={frame}>{renderScreen(frame.name)}</FrameProvider>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {flex: 1},
  frame: {...StyleSheet.absoluteFillObject, backgroundColor: colors.bgApp},
  hidden: {display: 'none'},
  fallback: {flex: 1, backgroundColor: colors.bgApp},
});
