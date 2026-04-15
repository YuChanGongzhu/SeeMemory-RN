import React, {useMemo, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useOpenClawChat} from '../hooks/useOpenClawChat';
import type {ChatMessage, SessionListItem} from '../openclaw/types';

export function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const {
    settings,
    draftSessionKey,
    activeSessionKey,
    sessions,
    isHydrated,
    connectionState,
    statusText,
    messages,
    isSending,
    updateSetting,
    setDraftSessionKey,
    connect,
    disconnect,
    createSession,
    selectSession,
    refreshSessions,
    sendMessage,
  } = useOpenClawChat();

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const sent = await sendMessage(inputText);
    if (sent) {
      setInputText('');
    }
  };

  const isConnected = connectionState === 'connected';
  const canSend = isConnected && !isSending && !!inputText.trim();
  const statusColor = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return '#4CAF50';
      case 'connecting':
      case 'loading':
        return '#FF9800';
      case 'error':
        return '#F44336';
      default:
        return '#666666';
    }
  }, [connectionState]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <View>
          <Text style={styles.title}>AI Chat Demo</Text>
          <Text style={styles.subtitle}>基于 openclaw-demo 的最小可演示版本</Text>
        </View>
        <Text style={styles.recordIcon}>💬</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
        ListHeaderComponent={
          <View style={styles.configCard}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
              <Text style={styles.statusText}>{statusText}</Text>
            </View>

            <Text style={styles.sectionLabel}>Gateway URL</Text>
            <TextInput
              style={styles.configInput}
              placeholder="ws://43.136.45.132:18789"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              value={settings.url}
              onChangeText={value => updateSetting('url', value)}
            />

            <Text style={styles.sectionLabel}>Token</Text>
            <TextInput
              style={styles.configInput}
              placeholder="demo-token-123"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              value={settings.token}
              onChangeText={value => updateSetting('token', value)}
            />

            <Text style={styles.sectionLabel}>New Session Key</Text>
            <View style={styles.sessionCreateRow}>
              <TextInput
                style={[styles.configInput, styles.sessionInput]}
                placeholder="main"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoCorrect={false}
                value={draftSessionKey}
                onChangeText={setDraftSessionKey}
              />
              <TouchableOpacity
                style={styles.newSessionButton}
                onPress={createSession}>
                <Text style={styles.newSessionButtonText}>新开会话</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sessionHint}>
              当前激活会话为 `{activeSessionKey}`。输入框只用于新开会话，不会直接改写当前会话。
            </Text>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.primaryAction, !isHydrated && styles.disabledAction]}
                disabled={!isHydrated || connectionState === 'connecting'}
                onPress={connect}>
                {connectionState === 'connecting' ? (
                  <ActivityIndicator size="small" color="#0D0D0D" />
                ) : (
                  <Text style={styles.primaryActionText}>
                    {isConnected ? '重新连接' : '连接'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryAction, !isConnected && styles.disabledSecondary]}
                disabled={!isConnected}
                onPress={disconnect}>
                <Text style={styles.secondaryActionText}>断开</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sessionListHeader}>
              <Text style={styles.aiTitle}>会话列表</Text>
              <TouchableOpacity
                style={styles.refreshLink}
                onPress={refreshSessions}
                disabled={!isConnected}>
                <Text style={styles.refreshLinkText}>刷新</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sessionList}>
              {sessions.map(item => (
                <SessionChip
                  key={item.key}
                  item={item}
                  active={item.key === activeSessionKey}
                  onPress={selectSession}
                />
              ))}
            </ScrollView>

            <View style={styles.welcomeCard}>
              <Text style={styles.aiTitle}>演示说明</Text>
              <Text style={styles.aiSubtitle}>
                现在页面支持手动创建 `sessionKey`、本地记住会话键，并通过
                `sessions.list` 和 `chat.history` 拉取不同会话内容。
              </Text>
            </View>
          </View>
        }
        renderItem={({item}) => <ChatBubble item={item} />}
        ListEmptyComponent={
          isHydrated ? (
            <Text style={styles.emptyText}>连接成功后就可以开始演示对话了</Text>
          ) : null
        }
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={isConnected ? '输入消息开始演示...' : '请先连接 Gateway'}
          placeholderTextColor="#666"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
          editable={isConnected && !isSending}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.disabledSendBtn]}
          onPress={handleSend}
          disabled={!canSend}>
          <Text style={styles.sendBtnText}>{isSending ? '等待中' : '发送'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChatBubble({item}: {item: ChatMessage}) {
  const isSystem = item.role === 'system';
  const isUser = item.role === 'user';

  return (
    <View
      style={[
        styles.messageBubble,
        isUser && styles.userBubble,
        item.role === 'assistant' && styles.assistantBubble,
        isSystem && styles.systemBubble,
      ]}>
      <Text
        style={[
          styles.messageText,
          isUser && styles.userBubbleText,
          isSystem && styles.systemBubbleText,
        ]}>
        {item.text}
        {item.isStreaming ? '▋' : ''}
      </Text>
    </View>
  );
}

function SessionChip(params: {
  item: SessionListItem;
  active: boolean;
  onPress: (sessionKey: string) => void;
}) {
  const label = params.item.title || params.item.key;

  return (
    <TouchableOpacity
      style={[styles.sessionChip, params.active && styles.sessionChipActive]}
      onPress={() => params.onPress(params.item.key)}>
      <Text style={[styles.sessionChipText, params.active && styles.sessionChipTextActive]}>
        {label}
      </Text>
      <Text style={styles.sessionChipSubtext}>{params.item.key}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  title: {
    color: '#E5E5E5',
    fontSize: 20,
    fontWeight: '600',
  },
  subtitle: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
  },
  recordIcon: {
    fontSize: 20,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  configCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginRight: 10,
  },
  statusText: {
    color: '#AAAAAA',
    fontSize: 13,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  configInput: {
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E5E5E5',
    fontSize: 14,
  },
  sessionCreateRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  sessionInput: {
    flex: 1,
  },
  newSessionButton: {
    backgroundColor: '#0F3B35',
    borderWidth: 1,
    borderColor: '#00D4AA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  newSessionButtonText: {
    color: '#00D4AA',
    fontSize: 13,
    fontWeight: '700',
  },
  sessionHint: {
    color: '#7F7F7F',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  primaryAction: {
    flex: 1,
    backgroundColor: '#00D4AA',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryAction: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#333',
  },
  secondaryActionText: {
    color: '#E5E5E5',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledAction: {
    opacity: 0.5,
  },
  disabledSecondary: {
    opacity: 0.5,
  },
  welcomeCard: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
  },
  sessionListHeader: {
    marginTop: 18,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshLink: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  refreshLinkText: {
    color: '#00D4AA',
    fontSize: 12,
    fontWeight: '600',
  },
  sessionList: {
    gap: 10,
    paddingBottom: 4,
  },
  sessionChip: {
    width: 180,
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2D2D2D',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sessionChipActive: {
    borderColor: '#00D4AA',
    backgroundColor: '#112824',
  },
  sessionChipText: {
    color: '#E5E5E5',
    fontSize: 13,
    fontWeight: '700',
  },
  sessionChipTextActive: {
    color: '#00D4AA',
  },
  sessionChipSubtext: {
    color: '#8A8A8A',
    fontSize: 11,
    marginTop: 6,
  },
  aiTitle: {
    color: '#00D4AA',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  aiSubtitle: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#E5E5E5',
    fontSize: 14,
    marginRight: 12,
    minHeight: 44,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: '#00D4AA',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 72,
    alignItems: 'center',
  },
  disabledSendBtn: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '600',
  },
  messageBubble: {
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1976D2',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#333',
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: '#2B2B2B',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messageText: {
    color: '#E5E5E5',
    fontSize: 14,
    lineHeight: 20,
  },
  userBubbleText: {
    color: '#FFFFFF',
  },
  systemBubbleText: {
    color: '#AAAAAA',
    fontSize: 12,
  },
});
