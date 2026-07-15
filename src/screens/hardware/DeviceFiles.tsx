/**
 * 设备文件浏览页 —— 替换「我的录音」区旧「全部下载」按钮的入口（现为「查看全部」）。
 * 两级浏览：一级按日期文件夹（倒序）罗列，可整天勾选或点进去；二级看当天每条
 * 「日期-文件名」再逐条勾选。两级都带「全选」。勾选后走 WiFi 快传同步进「我的录音」
 * ——与「WiFi 快传」页同一条高速链路（连接热点 → 正在快传 → 快传成功），比蓝牙快 10×。
 *
 * 数据源用 useMr20.listAllDeviceFiles（设备上全部录音，含已传输，可重新传输覆盖本地）；
 * 每条按 inbox 标注「已传输」；传输/连接的覆盖层复用 TransferBadge（状态取自 useMr20 的 wifi* 字段）。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Check, ChevronRight, Rocket} from 'lucide-react-native';
import {useMr20} from '../../hooks/useMr20';
import type {Mr20File} from '../../native/mr20/Mr20Client';
import {fileEpoch} from '../../services/mr20Ingest';
import {fmtDurationHuman as fmtHuman, fmtSize as fmtMB} from '../../services/mediaFormat';
import {SubHeader, IosAlert, HW} from './parts';
import {TransferBadge} from './TransferBadge';

const keyOf = (f: Mr20File) => `${f.dir}/${f.fname}`;
const stripMp3 = (n: string) => n.replace(/\.mp3$/i, '');
/** 当天内按录音时间倒序；解析不出的排后面（保持稳定）。 */
const byTimeDesc = (a: Mr20File, b: Mr20File) =>
  (fileEpoch(b.dir, b.fname) ?? 0) - (fileEpoch(a.dir, a.fname) ?? 0);

export function DeviceFiles({onBack}: {onBack: () => void}) {
  const {
    connState,
    connectedDevice,
    listAllDeviceFiles,
    inbox,
    startWifiTransfer,
    syncSelected,
  } = useMr20();

  const [files, setFiles] = useState<Mr20File[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openDir, setOpenDir] = useState<string | null>(null); // null=文件夹一级，否则=某天二级
  const [wifiAsk, setWifiAsk] = useState(false); // 「切换 WiFi 快传」确认弹窗

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await listAllDeviceFiles();
      if (!alive) {
        return;
      }
      setFiles(list);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [listAllDeviceFiles]);

  // 已传输集合：inbox 项 id 即 `${dir}/${fname}`，与 keyOf 口径一致。
  const transferred = useMemo(() => new Set(inbox.map(i => i.id)), [inbox]);

  // 注意：**不**在离开页面时 resetWifiTransfer——传输改为非阻塞浮标后，用户会主动
  // 返回主页边传边做别的事；卸载即 reset 会误取消进行中的快传。收尾由浮标「取消/知道了」处理。

  // 日期文件夹（倒序）→ 当天文件（按录音时间倒序）。
  const groups = useMemo(() => {
    const map = new Map<string, Mr20File[]>();
    for (const f of files) {
      const arr = map.get(f.dir) ?? [];
      arr.push(f);
      map.set(f.dir, arr);
    }
    for (const arr of map.values()) {
      arr.sort(byTimeDesc);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [files]);

  const selectedFiles = useMemo(
    () => files.filter(f => selected.has(keyOf(f))),
    [files, selected],
  );
  const selectedBytes = selectedFiles.reduce((n, f) => n + (f.size || 0), 0);
  const allSelected = files.length > 0 && selected.size === files.length;

  const openItems = useMemo(
    () => (openDir ? groups.find(([d]) => d === openDir)?.[1] ?? [] : []),
    [openDir, groups],
  );

  const toggleKeys = useCallback((keys: string[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) {
          next.add(k);
        } else {
          next.delete(k);
        }
      }
      return next;
    });
  }, []);

  const toggleOne = useCallback((f: Mr20File) => {
    setSelected(prev => {
      const next = new Set(prev);
      const k = keyOf(f);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    toggleKeys(files.map(keyOf), !allSelected);
  }, [files, allSelected, toggleKeys]);

  const dirSelCount = useCallback(
    (items: Mr20File[]) => items.filter(f => selected.has(keyOf(f))).length,
    [selected],
  );

  // 默认走蓝牙一键上传（逐文件，无需连热点）。
  const start = useCallback(() => {
    if (!selectedFiles.length) {
      return;
    }
    syncSelected(selectedFiles).catch(() => undefined);
  }, [selectedFiles, syncSelected]);

  // 手动切到 WiFi 快传：确认后让手机临时加入设备热点高速直传。
  const confirmWifi = useCallback(() => {
    setWifiAsk(false);
    if (!selectedFiles.length) {
      return;
    }
    startWifiTransfer(selectedFiles).catch(() => undefined);
  }, [selectedFiles, startWifiTransfer]);

  return (
    <View style={st.root}>
      <SubHeader
        title={openDir ?? '设备文件'}
        onBack={openDir ? () => setOpenDir(null) : onBack}
      />

      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        {connState !== 'connected' ? (
          <Text style={st.hint}>请先连接设备蓝牙，再浏览设备文件。</Text>
        ) : loading ? (
          <ActivityIndicator color={HW.blue} style={st.loading} />
        ) : files.length === 0 ? (
          <Text style={st.hint}>设备暂无录音。</Text>
        ) : openDir ? (
          // ---- 二级：某天的文件 ----
          <>
            <View style={st.selectHead}>
              <Text style={st.selectTitle}>{openDir}</Text>
              <TouchableOpacity
                onPress={() => {
                  const keys = openItems.map(keyOf);
                  toggleKeys(keys, dirSelCount(openItems) !== openItems.length);
                }}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={st.selectAll}>
                  {dirSelCount(openItems) === openItems.length ? '取消全选' : '全选'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={st.rowGap}>
              {openItems.map(f => {
                const checked = selected.has(keyOf(f));
                return (
                  <TouchableOpacity
                    key={keyOf(f)}
                    activeOpacity={0.7}
                    style={st.fileRow}
                    onPress={() => toggleOne(f)}>
                    <View style={[st.checkbox, checked && st.checkboxOn]}>
                      {checked ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                    </View>
                    <View style={st.flex1}>
                      <Text style={st.fileName} numberOfLines={1}>
                        {stripMp3(f.fname)}
                      </Text>
                      <Text style={st.fileMeta}>
                        {fmtHuman(f.seconds)} · {fmtMB(f.size)}
                      </Text>
                    </View>
                    {transferred.has(keyOf(f)) ? (
                      <View style={st.doneBadge}>
                        <Text style={st.doneBadgeText}>已传输</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : (
          // ---- 一级：日期文件夹 ----
          <>
            <View style={st.selectHead}>
              <Text style={st.selectTitle}>全部设备录音</Text>
              <TouchableOpacity onPress={toggleAll} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={st.selectAll}>{allSelected ? '取消全选' : '全选'}</Text>
              </TouchableOpacity>
            </View>
            <Text style={st.headHint}>已传输的录音仍在列表中，可重新传输以覆盖本地文件。</Text>
            <View style={st.rowGap}>
              {groups.map(([dir, items]) => {
                const sel = dirSelCount(items);
                const all = sel === items.length;
                const bytes = items.reduce((n, f) => n + (f.size || 0), 0);
                const done = items.filter(f => transferred.has(keyOf(f))).length;
                return (
                  <View key={dir} style={st.folderRow}>
                    <TouchableOpacity
                      onPress={() => toggleKeys(items.map(keyOf), !all)}
                      hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                      <View
                        style={[
                          st.checkbox,
                          all && st.checkboxOn,
                          !all && sel > 0 && st.checkboxPartial,
                        ]}>
                        {all ? (
                          <Check size={14} color="#fff" strokeWidth={3} />
                        ) : sel > 0 ? (
                          <View style={st.partialDash} />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={st.folderMain}
                      onPress={() => setOpenDir(dir)}>
                      <View style={st.flex1}>
                        <Text style={st.fileName}>{dir}</Text>
                        <Text style={st.fileMeta}>
                          {items.length} 个文件 · {fmtMB(bytes)} · 已传 {done}/{items.length}
                          {sel > 0 ? ` · 已选 ${sel}` : ''}
                        </Text>
                      </View>
                      <ChevronRight size={20} color={HW.textTertiary} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* 底部：默认蓝牙一键上传，下方「切换 WiFi 快传」次要链接 */}
      {connState === 'connected' && files.length > 0 ? (
        <View style={st.footer}>
          <TouchableOpacity
            style={[st.startBtn, selectedFiles.length === 0 && st.startBtnDisabled]}
            disabled={selectedFiles.length === 0}
            onPress={start}>
            <Text style={st.startBtnText}>
              蓝牙上传
              {selectedFiles.length ? `（${selectedFiles.length} 个 · ${fmtMB(selectedBytes)}）` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.wifiLink}
            disabled={selectedFiles.length === 0}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
            onPress={() => setWifiAsk(true)}>
            <Rocket size={14} color={selectedFiles.length === 0 ? HW.textTertiary : HW.blue} />
            <Text
              style={[st.wifiLinkText, selectedFiles.length === 0 && {color: HW.textTertiary}]}>
              切换 WiFi 快传，比蓝牙快 10× →
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 切到 WiFi 快传前的确认（复用 iOS 风弹窗）：加入设备热点高速直传 */}
      <IosAlert
        visible={wifiAsk}
        onClose={() => setWifiAsk(false)}
        title={`“SiMemory”想加入无线局域网“${connectedDevice?.name || 'MR20'}”吗？`}
        message="加入设备热点后可高速直传选中的录音，比蓝牙快约 10 倍。传输结束会自动断开热点。"
        buttons={[
          {text: '取消', onPress: () => setWifiAsk(false)},
          {text: '加入', bold: true, onPress: confirmWifi},
        ]}
      />

      {/* 非阻塞传输浮标：可点开看进度/取消，其余时间不挡操作 */}
      <TransferBadge />
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20, paddingBottom: 120},
  loading: {marginTop: 40},
  flex1: {flex: 1},
  rowGap: {gap: 10},
  hint: {fontSize: 14, color: HW.textSub, textAlign: 'center', paddingVertical: 40, lineHeight: 21},

  selectHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8},
  selectTitle: {fontSize: 17, fontWeight: '700', color: HW.textMain},
  selectAll: {fontSize: 14, color: HW.blue, fontWeight: '600'},
  headHint: {fontSize: 12, color: HW.textSub, lineHeight: 18, marginBottom: 14},

  doneBadge: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: HW.divider},
  doneBadgeText: {fontSize: 11, color: HW.textSub, fontWeight: '600'},

  folderRow: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: HW.card, borderRadius: 16, paddingLeft: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  folderMain: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingRight: 14},

  fileRow: {flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: HW.card, borderRadius: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  checkbox: {width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: HW.textTertiary, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: HW.blue, borderColor: HW.blue},
  checkboxPartial: {borderColor: HW.blue},
  partialDash: {width: 10, height: 2.5, borderRadius: 2, backgroundColor: HW.blue},
  fileName: {fontSize: 15, fontWeight: '600', color: HW.textMain, marginBottom: 2},
  fileMeta: {fontSize: 12, color: HW.textSub},

  footer: {position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingTop: 12, backgroundColor: 'rgba(249,249,251,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HW.divider},
  startBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 16, backgroundColor: HW.blue},
  startBtnDisabled: {backgroundColor: HW.textTertiary},
  startBtnText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  wifiLink: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12},
  wifiLinkText: {fontSize: 14, color: HW.blue, fontWeight: '600'},
});
