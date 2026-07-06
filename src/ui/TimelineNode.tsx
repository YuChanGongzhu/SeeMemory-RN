import React from 'react';
import {View, Text, Image, TouchableOpacity, StyleSheet} from 'react-native';
import {Play, Pause, FileText} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useImagePreview} from '../hooks/useImagePreview';
import type {TimelineRecord} from '../types/memory';

/** 秒 → 'm:ss'；无效/为空返回 ''。 */
function fmtSecs(s?: number): string {
  if (s == null || !isFinite(s) || s < 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Renders one 溯源时间流 node by type — faithful to prototype renderTimelineNode
 * (App.jsx:1246): audio dark pill / video 16:9 cover+Play / images full-width /
 * doc file card / text gray block.
 *
 * `playing` + `onTogglePlay` 让音频胶囊可点击播放/暂停（url 通过 node.url 传给上层）。
 */
export function TimelineNode({
  node,
  playing,
  onTogglePlay,
  playbackTime,
  playbackDuration,
}: {
  node: TimelineRecord;
  playing?: boolean;
  onTogglePlay?: (url: string) => void;
  playbackTime?: number;
  playbackDuration?: number;
}) {
  const {preview} = useImagePreview();
  const isAudio = !!node.audio || node.type === 'audio';
  const audioName = node.audio?.name || node.name || '语音记录';
  const canPlay = isAudio && !!node.url && !!onTogglePlay;
  // 播放中：显示真实「已播/总时长」（总时长由原生流式加载后回传）；否则回落静态时长。
  const live = playing
    ? [fmtSecs(playbackTime), fmtSecs(playbackDuration)].filter(Boolean).join(' / ')
    : '';
  const audioDur = live || node.audio?.duration || node.duration || (playing ? '播放中…' : '0:00');

  const videoCover = node.video?.cover || (node.type === 'video' ? node.url : undefined);
  const videoDur = node.video?.duration;

  const images = node.images || (node.type === 'image' && node.url ? [node.url] : []);

  const isDoc = !!node.doc || node.type === 'doc';
  const docName = node.doc?.name || node.name || '文档文件';
  const docSize = node.doc?.size;

  return (
    <View style={{gap: 10}}>
      {isAudio ? (
        <TouchableOpacity
          activeOpacity={canPlay ? 0.8 : 1}
          disabled={!canPlay}
          onPress={canPlay ? () => onTogglePlay!(node.url!) : undefined}
          style={styles.audio}>
          <View style={styles.audioPlay}>
            {playing ? (
              <Pause size={20} fill={colors.textMain} color={colors.textMain} />
            ) : (
              <Play size={20} fill={colors.textMain} color={colors.textMain} style={{marginLeft: 2}} />
            )}
          </View>
          <View style={{flex: 1, minWidth: 0}}>
            <Text style={styles.audioName} numberOfLines={1}>{audioName}</Text>
            <Text style={styles.audioDur}>{audioDur}</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {videoCover || (node.type === 'video' && !node.video) ? (
        <View style={styles.video}>
          {videoCover ? <Image source={{uri: videoCover}} style={styles.videoImg} /> : null}
          <View style={styles.videoOverlay}>
            <View style={styles.videoPlay}>
              <Play size={28} fill="#fff" color="#fff" style={{marginLeft: 3}} />
            </View>
          </View>
          {videoDur ? (
            <View style={styles.videoDur}>
              <Text style={styles.videoDurText}>{videoDur}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {images.length > 0 ? (
        <View style={{gap: 8}}>
          {images.map((u, i) => (
            <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => preview(u)}>
              <Image source={{uri: u}} style={styles.image} resizeMode="cover" />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {isDoc ? (
        <View style={styles.doc}>
          <View style={styles.docIcon}>
            <FileText size={24} color={colors.textMain} strokeWidth={1.5} />
          </View>
          <View style={{flex: 1, minWidth: 0}}>
            <Text style={styles.docName} numberOfLines={1}>{docName}</Text>
            <Text style={styles.docMeta}>{docSize ? `${docSize} • ` : ''}PDF 文档</Text>
          </View>
        </View>
      ) : null}

      {node.content ? (
        <View style={[styles.text, isAudio && styles.textOnAudio]}>
          <Text style={styles.textBody}>{node.content}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  audio: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.darkCard, borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: 16, alignSelf: 'flex-start', minWidth: 200},
  audioPlay: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  audioName: {fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4},
  audioDur: {fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.6)'},
  video: {position: 'relative', borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', width: '100%', aspectRatio: 16 / 9},
  videoImg: {width: '100%', height: '100%', opacity: 0.8},
  videoOverlay: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  videoPlay: {width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center'},
  videoDur: {position: 'absolute', bottom: 10, right: 12, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8},
  videoDurText: {color: '#fff', fontSize: 11, fontWeight: '600'},
  image: {width: '100%', aspectRatio: 4 / 3, borderRadius: 16},
  doc: {flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 16, padding: 16},
  docIcon: {width: 48, height: 48, borderRadius: 12, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  docName: {fontSize: 15, fontWeight: '600', color: colors.textMain, marginBottom: 4},
  docMeta: {fontSize: 12, fontWeight: '500', color: colors.textSub},
  text: {backgroundColor: colors.bgSecondary, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16},
  textOnAudio: {backgroundColor: colors.nested, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  textBody: {fontSize: 15, color: colors.textMain, lineHeight: 24},
});
