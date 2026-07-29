import React, {useMemo, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, Alert} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  ChevronLeft, Share2, MoreHorizontal, Sparkles, ChevronDown, PenLine, Plus, Trash2,
  MessageCircle, Aperture, Image as ImageIcon, Link as LinkIcon, X, QrCode, Download,
} from 'lucide-react-native';
import {colors, radius, shadow} from '../design/tokens';
import {GradientBg} from '../ui/Gradient';
import {TimelineNode} from '../ui/TimelineNode';
import {BottomSheet} from '../ui/BottomSheet';
import {useWriteGate} from '../hooks/useWriteGate';
import {useAudioPlayback} from '../hooks/useAudioPlayback';
import {useNav} from '../navigation/nav';
import {submitMemoryCorrection, newCorrectionRequestId} from '../apis/requests/corrections';
import type {MemoryCard, TimelineRecord} from '../types/memory';

function parseT(t?: string): number {
  const m = t?.match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}

interface Cluster {
  id: string | number;
  items: TimelineRecord[];
  name?: string | null;
}

export function MemoryDetail() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const gate = useWriteGate();
  const player = useAudioPlayback();
  const card: MemoryCard = nav.current.params?.card;

  const [activeTab, setActiveTab] = useState<'origin' | 'append'>('origin');
  const [highlightsOnly, setHighlightsOnly] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showShare, setShowShare] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showPoster, setShowPoster] = useState(false);

  // 只有真碎片能改：事件/汇总钻取的合成卡没有 fragmentId，发去修正必然 404。
  const writable = !!card?.fragmentId;

  /** 删除 = 提交一条 forget 修正命令，与首页左滑删除同一条链路。 */
  const deleteMemory = () => {
    const anchorId = card?.fragmentId;
    if (!anchorId) return;
    Alert.alert('删除这条记忆？', '将让 AI 忘记这条记忆及其关联内容，需要一点时间处理，不可撤销。', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          submitMemoryCorrection({
            anchorType: 'fragment',
            anchorId,
            instruction: '忘记这条记忆',
            requestId: newCorrectionRequestId(anchorId),
          })
            .then(() => nav.pop())
            .catch(e => Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试'));
        },
      },
    ]);
  };
  const [toast, setToast] = useState<string | null>(null);

  const hasAppended = !!card?.timelineRecords?.some(n => n.isAppended);
  const display = (card?.timelineRecords || []).filter(n => (activeTab === 'origin' ? !n.isAppended : n.isAppended));

  const clusters = useMemo<Cluster[]>(() => {
    let records = display;
    const out: Cluster[] = [];
    if (activeTab === 'origin' && highlightsOnly) {
      records = records.filter(r => r.isHighlight || (r.type !== 'audio' && !r.audio));
      records.forEach(r => out.push({items: [r], id: r.id}));
      return out;
    }
    let cur: (Cluster & {startTime: number; lastTime: number}) | null = null;
    records.forEach(r => {
      const rt = parseT(r.time);
      if (!cur) {
        cur = {items: [r], id: `tc_${r.id ?? rt}`, startTime: rt, lastTime: rt};
        out.push(cur);
      } else if (rt - cur.lastTime > 20 || rt - cur.startTime > 60) {
        cur = {items: [r], id: `tc_${r.id ?? rt}`, startTime: rt, lastTime: rt};
        out.push(cur);
      } else {
        cur.items.push(r);
        cur.lastTime = rt;
      }
    });
    out.forEach((c: any) => {
      if (c.items.length > 1) {
        const dur = c.lastTime - c.startTime;
        const s = c.items[0].time?.match(/\d{1,2}:\d{2}/)?.[0] || '';
        const e = c.items[c.items.length - 1].time?.match(/\d{1,2}:\d{2}/)?.[0] || '';
        if (dur <= 0 || s === e) {
          // 同一分钟内的片段：不再显示 "18:53 - 18:53 (1分钟)" 这种冗余区间。
          c.name = `${s} 期间片段`;
        } else {
          const ds = dur < 60 ? `${dur} 分钟` : `${Math.floor(dur / 60)} 小时 ${dur % 60} 分钟`;
          c.name = `${s} - ${e} 期间片段 (${ds})`;
        }
      } else c.name = null;
    });
    return out;
  }, [display, highlightsOnly, activeTab]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };
  // 点录音胶囊：播放/暂停远程录音（playingId 用 url 作 key）。失败给提示。
  const togglePlay = (url: string) => {
    player.toggle(url, url).catch(() => flash('无法播放该录音'));
  };
  const share = (action: string) => {
    setShowShare(false);
    if (action === 'wechat') flash('✓ 正在拉起微信小程序...');
    else if (action === 'moments') flash('✓ 已拉起朋友圈分享框...');
    else if (action === 'link') flash('🔗 专属记忆链接已复制');
    else if (action === 'poster') setShowPoster(true);
  };

  if (!card) return <View style={{flex: 1, backgroundColor: colors.bg}} />;

  return (
    <View style={{flex: 1, backgroundColor: colors.bg}}>
      {/* Header */}
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity style={styles.circleBtn} onPress={nav.pop}>
          <ChevronLeft size={24} strokeWidth={2.5} color={colors.textMain} />
        </TouchableOpacity>
        <View style={{flexDirection: 'row', gap: 12}}>
          <TouchableOpacity style={styles.circleBtn} onPress={() => setShowShare(true)}>
            <Share2 size={18} strokeWidth={2.3} color={colors.textMain} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.circleBtn} onPress={() => setShowMore(v => !v)}>
            <MoreHorizontal size={20} strokeWidth={2.3} color={colors.textMain} />
          </TouchableOpacity>
        </View>

        {showMore ? (
          <>
            <Pressable_overlay onPress={() => setShowMore(false)} />
            <View style={styles.moreMenu}>
              {writable ? (
                <>
                  <TouchableOpacity style={styles.moreItem} onPress={() => { setShowMore(false); gate(() => nav.push('editor', {mode: 'edit', card})); }}>
                    <PenLine size={16} strokeWidth={2.3} color={colors.textMain} />
                    <Text style={styles.moreText}>编辑记忆</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.moreItem} onPress={() => { setShowMore(false); gate(() => nav.push('editor', {mode: 'append', card})); }}>
                    <Plus size={16} strokeWidth={2.3} color={colors.textMain} />
                    <Text style={styles.moreText}>追加细节</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.moreItem} onPress={() => { setShowMore(false); gate(deleteMemory); }}>
                    <Trash2 size={16} strokeWidth={2.3} color={colors.danger} />
                    <Text style={[styles.moreText, {color: colors.danger}]}>删除记忆</Text>
                  </TouchableOpacity>
                </>
              ) : (
                // 事件钻取/汇总钻取合成的卡不是单条真实碎片，没有可修正的锚点。
                <Text style={[styles.moreText, styles.moreEmpty]}>这条记忆暂不支持编辑</Text>
              )}
            </View>
          </>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* AI summary block */}
        <View style={styles.aiBlock}>
          <GradientBg radius={radius.bigCard} />
          {card.hasAI ? (
            <View style={styles.aiHead}>
              <Sparkles size={16} color="#fff" />
              <Text style={styles.aiHeadText}>AI 核心概要</Text>
            </View>
          ) : null}
          {card.keyQuote ? <Text style={styles.keyQuote}>"{card.keyQuote}"</Text> : null}
          {card.tags?.length ? (
            <View style={styles.tagRow}>
              {card.tags.map(t => (
                <View key={t} style={styles.aiTag}><Text style={styles.aiTagText}>#{t}</Text></View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Pure text */}
        {card.aiSummary || card.content ? (
          <Text style={styles.text}>{card.aiSummary || card.content}</Text>
        ) : null}

        {/* Timeline */}
        {card.timelineRecords?.length ? (
          <View>
            <Text style={styles.tlLabel}>溯源时间流</Text>

            {hasAppended ? (
              <View style={styles.segTabs}>
                {(['origin', 'append'] as const).map(k => (
                  <TouchableOpacity key={k} style={[styles.segTab, activeTab === k && styles.segTabOn]} onPress={() => setActiveTab(k)}>
                    <Text style={[styles.segTabText, activeTab === k && styles.segTabTextOn]}>{k === 'origin' ? '溯源记录' : '补充细节'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {activeTab === 'origin' ? (
              <View style={styles.filterRow}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
                  <Sparkles size={14} color={colors.excite} />
                  <Text style={styles.filterHint}>AI 已折叠无意义噪音</Text>
                </View>
                <View style={styles.miniSeg}>
                  {[true, false].map(v => (
                    <TouchableOpacity key={String(v)} style={[styles.miniSegBtn, highlightsOnly === v && styles.miniSegBtnOn]} onPress={() => setHighlightsOnly(v)}>
                      <Text style={[styles.miniSegText, highlightsOnly === v && styles.miniSegTextOn]}>{v ? '高光' : '全量'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.tlBody}>
              <View style={styles.dashLine} />
              {clusters.length ? (
                clusters.map((c, i) => {
                  if (!c.name) {
                    const node = c.items[0];
                    return (
                      <View key={node.id ?? i} style={styles.tlRow}>
                        <View style={styles.dotHollow} />
                        <View style={{flex: 1, minWidth: 0}}>
                          <View style={styles.tlMeta}>
                            <Text style={styles.tlTime}>{node.time}</Text>
                            {node.clusterName ? <View style={styles.clusterBadge}><Text style={styles.clusterBadgeText}>{node.clusterName}</Text></View> : null}
                          </View>
                          <TimelineNode
                            node={node}
                            playing={!!node.url && player.playingId === node.url}
                            onTogglePlay={togglePlay}
                            playbackTime={player.playingId === node.url ? player.currentTime : undefined}
                            playbackDuration={player.playingId === node.url ? player.duration : undefined}
                          />
                        </View>
                      </View>
                    );
                  }
                  const open = !!expanded[c.id];
                  return (
                    <View key={c.id} style={{paddingLeft: 24}}>
                      <View style={styles.dotGroup}><View style={styles.dotGroupInner} /></View>
                      <TouchableOpacity style={styles.clusterHead} onPress={() => setExpanded(p => ({...p, [c.id]: !p[c.id]}))}>
                        <Text style={styles.clusterName} numberOfLines={1}>{c.name}</Text>
                        <View style={styles.clusterRight}>
                          <Text style={styles.clusterCount}>包含 {c.items.length} 段记录</Text>
                          <ChevronDown size={16} color={colors.textSub} style={{transform: [{rotate: open ? '180deg' : '0deg'}]}} />
                        </View>
                      </TouchableOpacity>
                      {open ? (
                        <View style={{gap: 24, marginTop: 16}}>
                          {c.items.map((node, j) => (
                            <View key={node.id ?? j} style={styles.tlRow}>
                              <View style={styles.dotHollowGray} />
                              <View style={{flex: 1, minWidth: 0}}>
                                <Text style={[styles.tlTime, {marginBottom: 8}]}>{node.time}</Text>
                                <TimelineNode
                            node={node}
                            playing={!!node.url && player.playingId === node.url}
                            onTogglePlay={togglePlay}
                            playbackTime={player.playingId === node.url ? player.currentTime : undefined}
                            playbackDuration={player.playingId === node.url ? player.duration : undefined}
                          />
                              </View>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <Text style={styles.empty}>暂无记录</Text>
              )}
            </View>
          </View>
        ) : (
          <Text style={styles.empty}>该记忆无更多时间流细节</Text>
        )}
        <View style={{height: 40}} />
      </ScrollView>

      {/* Toast */}
      {toast ? (
        <View style={[styles.toast, {bottom: insets.bottom + 60}]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {/* Share sheet */}
      <BottomSheet visible={showShare} onClose={() => setShowShare(false)} title="分享记忆">
        <View style={styles.shareRow}>
          {[
            {k: 'wechat', label: '微信好友', icon: <MessageCircle size={24} color="#07C160" />},
            {k: 'moments', label: '朋友圈', icon: <Aperture size={24} color="#07C160" />},
            {k: 'poster', label: '生成长图', icon: <ImageIcon size={24} color="#000" />},
            {k: 'link', label: '复制链接', icon: <LinkIcon size={24} color="#000" />},
          ].map(s => (
            <TouchableOpacity key={s.k} style={styles.shareItem} onPress={() => share(s.k)}>
              <View style={styles.shareIcon}>{s.icon}</View>
              <Text style={styles.shareLabel}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </BottomSheet>

      {/* Poster */}
      <Modal visible={showPoster} transparent animationType="fade" onRequestClose={() => setShowPoster(false)}>
        <View style={styles.posterRoot}>
          <TouchableOpacity style={[styles.posterClose, {top: insets.top + 12}]} onPress={() => setShowPoster(false)}>
            <X size={20} color="#fff" />
          </TouchableOpacity>
          <View style={styles.posterCard}>
            <Text style={styles.posterHeader}>June 19, 2026</Text>
            <Text style={styles.posterText} numberOfLines={8}>{card.aiSummary || card.content}</Text>
            {card.tags ? (
              <View style={styles.posterTags}>
                {card.tags.map(t => <Text key={t} style={styles.posterTag}>#{t}</Text>)}
              </View>
            ) : null}
            <View style={styles.posterFooter}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                <Sparkles size={16} color={colors.textMain} />
                <View>
                  <Text style={styles.posterBrand}>Remmy</Text>
                  <Text style={styles.posterSlogan}>咱们今天经历了什么</Text>
                </View>
              </View>
              <QrCode size={36} color={colors.textMain} strokeWidth={1.5} />
            </View>
          </View>
          <TouchableOpacity style={styles.savePoster} onPress={() => { setShowPoster(false); flash('✓ 已保存到手机相册'); }}>
            <Download size={20} strokeWidth={2.3} color={colors.textMain} />
            <Text style={styles.savePosterText}>保存到相册</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

function Pressable_overlay({onPress}: {onPress: () => void}) {
  return <TouchableOpacity activeOpacity={1} onPress={onPress} style={StyleSheet.absoluteFill} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    zIndex: 100,
  },
  circleBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow.soft},
  moreMenu: {position: 'absolute', top: 88, right: 20, backgroundColor: 'rgba(255,255,255,0.98)', borderRadius: 16, padding: 8, width: 150, ...shadow.card, zIndex: 110},
  moreItem: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10},
  moreText: {fontSize: 15, fontWeight: '600', color: colors.textMain},
  moreEmpty: {fontWeight: '400', color: colors.textSub, paddingVertical: 12, paddingHorizontal: 12},
  body: {paddingHorizontal: 24, paddingBottom: 40},
  aiBlock: {borderRadius: radius.bigCard, padding: 24, marginBottom: 32, overflow: 'hidden', backgroundColor: colors.darkCard},
  aiHead: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16},
  aiHeadText: {fontSize: 13, fontWeight: '700', color: '#fff'},
  keyQuote: {fontSize: 18, fontWeight: '600', lineHeight: 25, color: '#fff', marginBottom: 20},
  tagRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  aiTag: {backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20},
  aiTagText: {color: '#fff', fontSize: 12, fontWeight: '600'},
  text: {fontSize: 16, lineHeight: 29, color: colors.textMain, marginBottom: 40},
  tlLabel: {fontSize: 13, fontWeight: '700', color: colors.textSub, letterSpacing: 1, marginBottom: 16},
  segTabs: {flexDirection: 'row', backgroundColor: colors.bgSecondary, borderRadius: 10, padding: 3, marginBottom: 20},
  segTab: {flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center'},
  segTabOn: {backgroundColor: '#fff', ...shadow.soft},
  segTabText: {fontSize: 13, fontWeight: '600', color: colors.textSub},
  segTabTextOn: {color: colors.textMain},
  filterRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.bgSecondary},
  filterHint: {fontSize: 12, color: colors.textSub, fontWeight: '500'},
  miniSeg: {flexDirection: 'row', backgroundColor: colors.bgSecondary, borderRadius: 8, padding: 2},
  miniSegBtn: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6},
  miniSegBtnOn: {backgroundColor: '#fff'},
  miniSegText: {fontSize: 12, fontWeight: '600', color: colors.textSub},
  miniSegTextOn: {color: colors.textMain},
  tlBody: {position: 'relative', gap: 24, paddingLeft: 12},
  dashLine: {position: 'absolute', left: 15, top: 6, bottom: 0, width: 0, borderLeftWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)', borderStyle: 'dashed'},
  tlRow: {flexDirection: 'row', gap: 16},
  dotHollow: {width: 10, height: 10, borderRadius: 5, backgroundColor: colors.nested, borderWidth: 2, borderColor: colors.textMain, marginTop: 4, marginLeft: -4},
  dotHollowGray: {width: 10, height: 10, borderRadius: 5, backgroundColor: colors.nested, borderWidth: 2, borderColor: colors.textSub, marginTop: 4, marginLeft: -4},
  tlMeta: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  tlTime: {fontSize: 12, fontWeight: '600', color: colors.textSub},
  clusterBadge: {backgroundColor: colors.bgSecondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4},
  clusterBadgeText: {fontSize: 11, fontWeight: '600', color: colors.textMain},
  dotGroup: {position: 'absolute', left: -8, top: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.bgSecondary, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', zIndex: 2},
  dotGroupInner: {width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textSub},
  clusterHead: {backgroundColor: colors.nested, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  clusterName: {flex: 1, minWidth: 0, marginRight: 8, fontSize: 14, fontWeight: '600', color: colors.textMain},
  clusterRight: {flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0},
  clusterCount: {fontSize: 12, color: colors.textSub},
  empty: {textAlign: 'center', paddingVertical: 40, color: colors.textSub, fontSize: 14},
  toast: {position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(26,26,26,0.92)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14},
  toastText: {color: '#fff', fontSize: 14, fontWeight: '500'},
  shareRow: {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10},
  shareItem: {alignItems: 'center', gap: 8},
  shareIcon: {width: 56, height: 56, borderRadius: 28, backgroundColor: colors.nested, alignItems: 'center', justifyContent: 'center', ...shadow.soft},
  shareLabel: {fontSize: 12, color: colors.textSub},
  posterRoot: {flex: 1, backgroundColor: 'rgba(20,20,20,0.95)', alignItems: 'center', justifyContent: 'center', padding: 24},
  posterClose: {position: 'absolute', right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center'},
  posterCard: {width: '100%', maxWidth: 340, backgroundColor: '#F7F7F5', borderRadius: 16, padding: 24, minHeight: 320},
  posterHeader: {fontSize: 13, fontWeight: '700', color: colors.textSub, marginBottom: 20},
  posterText: {fontSize: 16, color: colors.textMain, lineHeight: 26, fontWeight: '700', flex: 1},
  posterTags: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16},
  posterTag: {fontSize: 11, color: colors.textSub, fontWeight: '600'},
  posterFooter: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  posterBrand: {fontSize: 13, fontWeight: '800', color: colors.textMain},
  posterSlogan: {fontSize: 10, color: colors.textSub, marginTop: 2},
  savePoster: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 40, marginTop: 24},
  savePosterText: {fontSize: 16, fontWeight: '700', color: colors.textMain},
});
