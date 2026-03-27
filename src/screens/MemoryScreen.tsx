import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useMemoryRecall} from '../hooks/useMemoryRecall';
import {MemoryCard} from '../components/MemoryCard';

export function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const {memories, isLoading, recall} = useMemoryRecall();

  const handleSend = async () => {
    if (!inputText.trim()) return;
    await recall(inputText);
    setInputText('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={styles.title}>RingMemory</Text>
        <Text style={styles.recordIcon}>🎤</Text>
      </View>

      <FlatList
        data={memories}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.welcomeCard}>
            <Text style={styles.aiTitle}>AI 助手</Text>
            <Text style={styles.aiSubtitle}>有什么可以帮你回忆的？</Text>
          </View>
        }
        renderItem={({item}) => (
          <MemoryCard
            content={item.content}
            timestamp={item.timestamp}
            onPlay={() => console.log('Play:', item.id)}
            onViewOriginal={() => console.log('View original:', item.id)}
            onShare={() => console.log('Share:', item.id)}
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={styles.emptyText}>开始提问，召回你的记忆</Text>
          ) : null
        }
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="问我记住了什么..."
          placeholderTextColor="#666"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendBtnText}>发送</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  recordIcon: {
    fontSize: 20,
  },
  list: {
    padding: 16,
  },
  welcomeCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
    padding: 16,
    marginBottom: 16,
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
  },
  input: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#E5E5E5',
    fontSize: 14,
    marginRight: 12,
  },
  sendBtn: {
    backgroundColor: '#00D4AA',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '600',
  },
});
