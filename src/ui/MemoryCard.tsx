import React, {useRef, useState} from 'react';
import {
  View,
  Text,
  Image,
  Animated,
  PanResponder,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import {Play, Link as LinkIcon, RefreshCw, Mic, Share2, PenLine, Plus, Trash2, ImageOff} from 'lucide-react-native';
import {colors, radius, shadow, type as T} from '../design/tokens';
import type {MemoryCard as MemoryCardModel} from '../types/memory';

const ACTIONS_W = 240;

function ActionBtn({
  children,
  onPress,
  danger,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.action, {backgroundColor: danger ? colors.dangerSoft : colors.border}]}>
      {children}
    </TouchableOpacity>
  );
}

/**
 * 卡片缩略图：列表里要把整张原图（后端无缩略图变体，url 即原文件）解码进 84×84
 * 小框，iOS 在长列表里并发解码多张大图时会偶发丢帧 —— 原来没有 onError 兜底，失败
 * 就只露出容器灰底，于是「有的图能显示有的不能」；而详情页用同一个 url、少量大图
 * 逐张解码，所以点进去总能看到大图。这里失败时自动重试一次，仍失败才显示占位图标，
 * 不再留一个会让人误解成「没有图」的空白灰块。参考 ChatPage 的 ChatImage 兜底。
 */
function CardThumb({uri}: {uri: string}) {
  const [attempt, setAttempt] = useState(0);
  if (attempt >= 2) {
    return (
      <View style={styles.thumbFallback}>
        <ImageOff size={20} color={colors.textSub} />
      </View>
    );
  }
  return (
    <Image
      key={attempt}
      source={{uri}}
      style={styles.mediaImg}
      resizeMode="cover"
      onError={() => setAttempt(a => a + 1)}
    />
  );
}

/**
 * Memory card with left-swipe reveal (share / edit / append / delete).
 * Faithful to prototype HomeTab card (App.jsx:1990-2090); the time column is
 * rendered by the feed, not here.
 */
export function MemoryCard({
  card,
  blurred,
  onPress,
  onShare,
  onEdit,
  onAppend,
  onDelete,
}: {
  card: MemoryCardModel;
  blurred?: boolean;
  onPress?: () => void;
  onShare?: () => void;
  onEdit?: () => void;
  onAppend?: () => void;
  onDelete?: () => void;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snap = (open: boolean) => {
    openRef.current = open;
    Animated.spring(tx, {toValue: open ? -ACTIONS_W : 0, useNativeDriver: true, bounciness: 4}).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -ACTIONS_W : 0;
        let next = base + g.dx;
        if (next > 0) next = 0;
        if (next < -ACTIONS_W) next = -ACTIONS_W;
        tx.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        if (blurred) return snap(false);
        if (g.dx < -40) snap(true);
        else if (g.dx > 40) snap(false);
        else snap(openRef.current);
      },
    }),
  ).current;

  const mediaUrl = card.images?.[0] || card.image || card.video;
  const hasMultiple = !!card.images && card.images.length > 1;
  const isVideo = !!card.video;

  return (
    <View style={styles.wrap}>
      {/* swipe action row (revealed underneath) */}
      {!blurred ? (
        <View style={styles.actions} pointerEvents="box-none">
          <ActionBtn onPress={onShare}><Share2 size={20} color={colors.textMain} /></ActionBtn>
          <ActionBtn onPress={onEdit}><PenLine size={20} color={colors.textMain} /></ActionBtn>
          <ActionBtn onPress={onAppend}><Plus size={20} color={colors.textMain} /></ActionBtn>
          <ActionBtn danger onPress={onDelete}><Trash2 size={20} color={colors.danger} /></ActionBtn>
        </View>
      ) : null}

      <Animated.View style={{transform: [{translateX: tx}]}} {...pan.panHandlers}>
        <TouchableWithoutFeedback onPress={() => (openRef.current ? snap(false) : onPress?.())}>
          <View style={[styles.card, blurred && styles.blurred]}>
            {card.title ? <Text style={styles.title}>{card.title}</Text> : null}

            <View style={styles.row}>
              <View style={{flex: 1, minWidth: 0}}>
                {card.content || card.aiSummary ? (
                  <Text
                    style={[
                      styles.body,
                      card.title ? {color: colors.textSub} : {color: colors.textMain, fontSize: 15},
                    ]}
                    numberOfLines={card.title ? 3 : 4}>
                    {card.content || card.aiSummary}
                  </Text>
                ) : null}

                {card.link ? (
                  <View style={styles.link}>
                    <View style={styles.linkIcon}>
                      <LinkIcon size={14} color={colors.textSub} />
                    </View>
                    <Text style={styles.linkTitle} numberOfLines={1}>{card.link.title}</Text>
                  </View>
                ) : null}

                {card.audioDuration ? (
                  <View style={styles.audio}>
                    <Play size={12} fill={colors.textMain} color={colors.textMain} />
                    <Text style={styles.audioText}>{card.audioDuration}</Text>
                  </View>
                ) : null}
              </View>

              {mediaUrl ? (
                <View style={styles.media}>
                  <CardThumb uri={mediaUrl} />
                  {isVideo ? (
                    <View style={styles.playOverlay}>
                      <View style={styles.playBtn}>
                        <Play size={12} fill="#fff" color="#fff" style={{marginLeft: 2}} />
                      </View>
                    </View>
                  ) : null}
                  {hasMultiple ? (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>+{card.images!.length - 1}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            {card.updateTime || card.audioCount ? (
              <View style={styles.footer}>
                {card.updateTime ? (
                  <View style={styles.fBadge}>
                    <RefreshCw size={12} color={colors.textMain} />
                    <Text style={styles.fBadgeText}>{card.updateTime} 更新</Text>
                  </View>
                ) : null}
                {card.audioCount ? (
                  <View style={styles.fBadge}>
                    <Mic size={12} color={colors.textMain} />
                    <Text style={styles.fBadgeText}>{card.audioCount} 条语音</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </TouchableWithoutFeedback>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {borderRadius: radius.bigCard, overflow: 'hidden', backgroundColor: colors.nested, ...shadow.card},
  actions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTIONS_W,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 12,
    paddingRight: 16,
    paddingLeft: 8,
    gap: 8,
  },
  action: {flex: 1, borderRadius: radius.xxl, alignItems: 'center', justifyContent: 'center'},
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.bigCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.03)',
    padding: 20,
  },
  blurred: {opacity: 0.85},
  title: {...(T.memTitle as object), color: colors.textMain, fontWeight: '600', marginBottom: 8},
  row: {flexDirection: 'row', alignItems: 'flex-start'},
  body: {...(T.memBody as object)},
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.nested,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  linkIcon: {width: 24, height: 24, borderRadius: 6, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center'},
  linkTitle: {flex: 1, fontSize: 13, fontWeight: '600', color: colors.textMain},
  audio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.bgSecondary,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.xl,
    marginTop: 12,
  },
  audioText: {fontSize: 12, fontWeight: '700', color: colors.textMain},
  media: {width: 84, height: 84, borderRadius: 12, overflow: 'hidden', marginLeft: 16, backgroundColor: colors.bgSecondary},
  mediaImg: {width: '100%', height: '100%'},
  thumbFallback: {width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center'},
  playOverlay: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center'},
  playBtn: {width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center'},
  countBadge: {position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2},
  countBadgeText: {fontSize: 11, fontWeight: '700', color: '#fff'},
  footer: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16},
  fBadge: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.bgSecondary, borderRadius: 12},
  fBadgeText: {fontSize: 12, fontWeight: '600', color: colors.textMain},
});
