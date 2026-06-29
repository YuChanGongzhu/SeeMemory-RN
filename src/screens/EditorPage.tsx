import React, {useState} from 'react';
import {View, Text, TextInput, ScrollView, TouchableOpacity, Image, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {X, Sparkles, Image as ImageIcon, Video, Mic, Paperclip, Play, FileText} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useNav} from '../navigation/nav';

type Block =
  | {id: string; type: 'text'; value: string}
  | {id: string; type: 'image' | 'video'; url: string}
  | {id: string; type: 'audio'; name: string; duration: string}
  | {id: string; type: 'doc'; name: string};

let seq = 0;
const uid = () => `b_${++seq}`;

/** 编辑器 — block editor (new/edit/append). Faithful to prototype EditorPage (App.jsx:1658). */
export function EditorPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const params = nav.current.params || {};
  const mode: 'new' | 'edit' | 'append' = params.mode || 'new';
  const headerTitle = mode === 'append' ? '追加细节' : mode === 'edit' ? '编辑记忆' : '记录思绪';

  const [title, setTitle] = useState(mode === 'edit' ? params.card?.title || '' : '');
  const [blocks, setBlocks] = useState<Block[]>([
    {id: uid(), type: 'text', value: mode === 'edit' ? params.card?.content || params.card?.aiSummary || '' : ''},
  ]);
  const [saving, setSaving] = useState(false);

  const hasContent = blocks.some(b => (b.type === 'text' ? b.value.trim() : true));

  const addMedia = (b: Block) => setBlocks(prev => [...prev, b, {id: uid(), type: 'text', value: ''}]);
  const removeBlock = (id: string) => setBlocks(prev => prev.filter(b => b.id !== id));
  const setText = (id: string, value: string) =>
    setBlocks(prev => prev.map(b => (b.id === id && b.type === 'text' ? {...b, value} : b)));

  const save = () => {
    if (!hasContent || saving) return;
    setSaving(true);
    setTimeout(() => nav.pop(), 800);
  };

  return (
    <View style={[styles.root, {paddingTop: insets.top + 8}]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={nav.pop}>
          <X size={20} strokeWidth={2.4} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <TouchableOpacity
          style={[styles.saveBtn, {backgroundColor: hasContent ? colors.primary : colors.border}]}
          onPress={save}
          disabled={!hasContent || saving}>
          {saving ? <Sparkles size={14} color="#fff" /> : null}
          <Text style={[styles.saveText, {color: hasContent ? '#fff' : colors.textSub}]}>{saving ? 'AI 解析中' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{flex: 1}} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.title}
          placeholder="标题 (可选)"
          placeholderTextColor={colors.textTertiary}
          value={title}
          onChangeText={setTitle}
        />
        {blocks.map((b, idx) =>
          b.type === 'text' ? (
            <TextInput
              key={b.id}
              style={styles.text}
              placeholder={idx === 0 ? '现在的想法是...' : '继续输入...'}
              placeholderTextColor={colors.textTertiary}
              value={b.value}
              onChangeText={t => setText(b.id, t)}
              multiline
            />
          ) : b.type === 'image' || b.type === 'video' ? (
            <View key={b.id} style={styles.mediaBlock}>
              <Image source={{uri: b.url}} style={styles.mediaImg} resizeMode="cover" />
              {b.type === 'video' ? (
                <View style={styles.videoPlay}><Play size={20} fill={colors.textMain} color={colors.textMain} style={{marginLeft: 3}} /></View>
              ) : null}
              <TouchableOpacity style={styles.removeMedia} onPress={() => removeBlock(b.id)}><X size={16} color="#fff" /></TouchableOpacity>
            </View>
          ) : b.type === 'audio' ? (
            <View key={b.id} style={styles.audio}>
              <View style={styles.audioPlay}><Play size={20} fill="#fff" color="#fff" style={{marginLeft: 3}} /></View>
              <View style={{flex: 1}}>
                <Text style={styles.audioName}>{b.name}</Text>
                <Text style={styles.audioDur}>{b.duration}</Text>
              </View>
              <TouchableOpacity style={styles.removeChip} onPress={() => removeBlock(b.id)}><X size={14} strokeWidth={2.4} color="#fff" /></TouchableOpacity>
            </View>
          ) : b.type === 'doc' ? (
            <View key={b.id} style={styles.doc}>
              <View style={styles.docIcon}><FileText size={20} color={colors.textMain} /></View>
              <Text style={styles.docName}>{b.name}</Text>
              <TouchableOpacity style={[styles.removeChip, {backgroundColor: colors.textSub}]} onPress={() => removeBlock(b.id)}><X size={14} strokeWidth={2.4} color="#fff" /></TouchableOpacity>
            </View>
          ) : null,
        )}
      </ScrollView>

      <View style={[styles.toolbar, {paddingBottom: insets.bottom + 16}]}>
        <TouchableOpacity style={styles.polish}>
          <Sparkles size={16} fill="#fff" color="#fff" />
          <Text style={styles.polishText}>AI 帮你润色</Text>
        </TouchableOpacity>
        <View style={{flexDirection: 'row', gap: 12}}>
          <TouchableOpacity style={styles.mediaBtn} onPress={() => addMedia({id: uid(), type: 'image', url: 'https://images.unsplash.com/photo-1495360010541-f48722b34f7d?q=80&w=1200&auto=format&fit=crop'})}><ImageIcon size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={() => addMedia({id: uid(), type: 'video', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200&auto=format&fit=crop'})}><Video size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={() => addMedia({id: uid(), type: 'audio', name: '语音记录', duration: '0:45'})}><Mic size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={() => addMedia({id: uid(), type: 'doc', name: '补充材料.pdf'})}><Paperclip size={20} strokeWidth={2.2} color={colors.textMain} /></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16},
  closeBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain},
  saveBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20},
  saveText: {fontSize: 14, fontWeight: '600'},
  body: {paddingHorizontal: 24, paddingVertical: 24},
  title: {fontSize: 24, fontWeight: '700', color: colors.textMain, marginBottom: 20, padding: 0},
  text: {fontSize: 17, lineHeight: 27, color: colors.textMain, marginBottom: 12, padding: 0, minHeight: 40},
  mediaBlock: {width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: colors.border, marginVertical: 8},
  mediaImg: {width: '100%', aspectRatio: 4 / 3},
  videoPlay: {position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center'},
  removeMedia: {position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center'},
  audio: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.dark, borderRadius: radius.pill, padding: 14, marginVertical: 8},
  audioPlay: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  audioName: {fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4},
  audioDur: {fontSize: 12, color: 'rgba(255,255,255,0.5)'},
  removeChip: {position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  doc: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bgSecondary, borderRadius: 16, padding: 16, marginVertical: 8},
  docIcon: {width: 40, height: 40, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  docName: {flex: 1, fontSize: 15, fontWeight: '600', color: colors.textMain},
  toolbar: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.04)'},
  polish: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.dark, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16},
  polishText: {fontSize: 14, fontWeight: '600', color: '#fff'},
  mediaBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
});
