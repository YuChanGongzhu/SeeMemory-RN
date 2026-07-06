import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Mic, Image as ImageIcon, FileText, type LucideIcon} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {BottomSheet} from '../ui/BottomSheet';

export type SortBy = 'created' | 'updated';
export type MediaType = 'all' | 'audio' | 'visual' | 'text';

const SORT_OPTS: {id: SortBy; label: string}[] = [
  {id: 'created', label: '按记录时间'},
  {id: 'updated', label: '按最近活跃'},
];

const MEDIA_OPTS: {id: MediaType; label: string; Icon?: LucideIcon}[] = [
  {id: 'all', label: '全部'},
  {id: 'audio', label: '语音', Icon: Mic},
  {id: 'visual', label: '图像', Icon: ImageIcon},
  {id: 'text', label: '纯文字', Icon: FileText},
];

/** 「视图与筛选」底部弹窗 — 排序逻辑 + 内容载体，选项即时生效（无 Apply）。原型 App.jsx:2217。 */
export function HomeFilterSheet({
  visible,
  onClose,
  sortBy,
  onSortBy,
  mediaType,
  onMediaType,
}: {
  visible: boolean;
  onClose: () => void;
  sortBy: SortBy;
  onSortBy: (v: SortBy) => void;
  mediaType: MediaType;
  onMediaType: (v: MediaType) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="视图与筛选">
      <Text style={styles.label}>排序逻辑</Text>
      <View style={styles.row}>
        {SORT_OPTS.map(opt => {
          const on = sortBy === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              activeOpacity={0.8}
              onPress={() => onSortBy(opt.id)}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.label, {marginTop: 24}]}>内容载体</Text>
      <View style={styles.row}>
        {MEDIA_OPTS.map(({id, label, Icon}) => {
          const on = mediaType === id;
          return (
            <TouchableOpacity
              key={id}
              activeOpacity={0.8}
              onPress={() => onMediaType(id)}
              style={[styles.chip, on && styles.chipOn]}>
              {Icon ? <Icon size={14} color={on ? '#fff' : colors.textMain} /> : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity style={styles.doneBtn} activeOpacity={0.85} onPress={onClose}>
        <Text style={styles.doneText}>查看筛选结果</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: {fontSize: 14, fontWeight: '700', color: colors.textSub, marginBottom: 12},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSecondary,
  },
  chipOn: {backgroundColor: colors.textMain},
  chipText: {fontSize: 14, fontWeight: '600', color: colors.textMain},
  chipTextOn: {color: '#fff'},
  doneBtn: {
    marginTop: 28,
    backgroundColor: colors.textMain,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneText: {fontSize: 15, fontWeight: '700', color: '#fff'},
});
