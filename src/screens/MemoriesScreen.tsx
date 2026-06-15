import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../theme/index';
import {StarIcon, ClockIcon} from '../components/Icons';
import {FadeUpView} from '../components/Animated';

const {width: SCREEN_WIDTH} = Dimensions.get('window');

type Tab = 'time' | 'summary' | 'todo';

type MediaItem = {
  id: string;
  type: '图片' | '视频' | '音频' | '文字';
  title: string;
  when: string;
  ts: number;
  hue: number;
};

type Day = {
  id: string;
  date: string;
  rel: string;
  title: string;
  season: string;
  hue: number;
};

type Summary = {
  id: string;
  title: string;
  time: string;
  dur: string;
  abstract: string;
  todoN: number;
  decN: number;
};

type Todo = {
  id: string;
  text: string;
  time: string;
  pri: '高' | '中' | '低';
  source: string;
  done: boolean;
};

type EditTodo = {
  id: string | null;
  text: string;
  time: string;
  pri: '高' | '中' | '低';
  source: string;
};

// ──────────────────────────────────────────────
// Mock data
// ──────────────────────────────────────────────
const seasonColors: Record<string, {main: string; soft: string}> = {
  '春': {main: '#7FA868', soft: '#E8EEDD'},
  '夏': {main: '#3F8A82', soft: '#DCEAE6'},
  '秋': {main: '#C2803C', soft: '#F2E6D4'},
  '冬': {main: '#7C92A6', soft: '#E4E9EE'},
};

const typeColors: Record<string, {main: string; soft: string}> = {
  '图片': {main: '#3F8A82', soft: '#DCEAE6'},
  '视频': {main: '#C2803C', soft: '#F2E6D4'},
  '音频': {main: '#7C92A6', soft: '#E4E9EE'},
  '文字': {main: '#7FA868', soft: '#E8EEDD'},
};

const mockMedia: MediaItem[] = [
  {id: 'me1', type: '视频', title: '厨房升起的热气', when: '今天 19:05', ts: 202606121905, hue: 30},
  {id: 'me2', type: '图片', title: '6神在啃彩色玉米', when: '今天 13:30', ts: 202606121330, hue: 96},
  {id: 'me3', type: '音频', title: '产品评审会', when: '今天 10:00', ts: 202606121000, hue: 42},
  {id: 'me4', type: '文字', title: '想换个城市看看', when: '昨天 22:10', ts: 202606112210, hue: 150},
  {id: 'me7', type: '音频', title: '和妈妈的语音', when: '昨天 21:10', ts: 202606112110, hue: 20},
  {id: 'me5', type: '图片', title: '海边，风很大', when: '6月7日', ts: 202606071200, hue: 196},
  {id: 'me6', type: '视频', title: '她第一次喊"妈妈"', when: '5月20日', ts: 202605201000, hue: 96},
  {id: 'me8', type: '图片', title: '银杏铺满了整条路', when: '去年秋天', ts: 202510181500, hue: 42},
];

const mockDays: Day[] = [
  {id: 'd1', date: '2026年6月11日', rel: '昨天', title: '写贪吃蛇代码的那天', season: '夏', hue: 178},
  {id: 'd2', date: '2026年6月7日', rel: '上周日', title: '海边，风很大', season: '夏', hue: 196},
  {id: 'd6', date: '2025年10月18日', rel: '去年秋天', title: '银杏铺满了整条路', season: '秋', hue: 42},
  {id: 'd5', date: '2025年12月20日', rel: '去年冬天', title: '初雪，窗上全是雾', season: '冬', hue: 212},
  {id: 'd3', date: '2026年5月20日', rel: '上个月', title: '她第一次喊"妈妈"', season: '春', hue: 96},
  {id: 'd4', date: '2025年6月12日', rel: '去年今天', title: '同一条河堤，那时还冷', season: '春', hue: 128},
];

const mockSummaries: Summary[] = [
  {
    id: 's1',
    title: '产品评审会',
    time: '今天 10:00',
    dur: '1h02m',
    abstract: '围绕"常态化录音"的产品定位展开：主打低门槛、强陪伴。麦克风与按键布局以单手操作为先，首版以功能可用优先于外观。',
    todoN: 3,
    decN: 2,
  },
  {
    id: 's2',
    title: '和妈妈的语音',
    time: '昨天 21:10',
    dur: '14m',
    abstract: '她叮嘱降温记得加衣，说院子里的月季开了，让你周末有空回去看看。',
    todoN: 1,
    decN: 0,
  },
];

const initialTodos: Todo[] = [
  {id: 't1', text: '确认麦克风灵敏度并筛选最优方案', time: '明天 14:00', pri: '高', source: '产品评审会', done: false},
  {id: 't2', text: '3D 打印验证按键布局与触感', time: '明天', pri: '高', source: '产品评审会', done: false},
  {id: 't3', text: '周末回家看看院子里的月季', time: '周六', pri: '中', source: '和妈妈的语音', done: false},
  {id: 't4', text: '给 6神 补点彩色玉米', time: '今天 20:00', pri: '低', source: '手动', done: true},
];

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function MediaThumb({item}: {item: MediaItem}) {
  const tc = typeColors[item.type] || typeColors['图片'];
  const isPlayable = item.type === '视频' || item.type === '音频';
  return (
    <View style={[styles.mediaThumb, {backgroundColor: `hsl(${item.hue}, 26%, 84%)`}]}>
      <View style={[styles.mediaTypeBadge, {backgroundColor: 'rgba(255,255,255,0.92)'}]}>
        <Text style={[styles.mediaTypeText, {color: tc.main}]}>{item.type}</Text>
      </View>
      {isPlayable && (
        <View style={styles.playIcon}>
          <Text style={{color: '#fff', fontSize: 10}}>▶</Text>
        </View>
      )}
    </View>
  );
}

function DayHCard({day}: {day: Day}) {
  const sc = seasonColors[day.season] || seasonColors['夏'];
  return (
    <TouchableOpacity style={styles.dayHCard} activeOpacity={0.7}>
      <View style={[styles.dayHThumb, {backgroundColor: `hsl(${day.hue}, 26%, 84%)`}]}>
        <Text style={[styles.dayThumbLabel, {color: `hsl(${day.hue}, 24%, 35%)`}]}>{day.rel}</Text>
      </View>
      <View style={styles.dayHInfo}>
        <View style={[styles.daySeasonBadge, {backgroundColor: sc.soft}]}>
          <Text style={[styles.daySeasonText, {color: sc.main}]}>{day.season}</Text>
        </View>
        <Text style={styles.dayRelText}>{day.rel}</Text>
      </View>
      <Text style={styles.dayHTitle} numberOfLines={2}>{day.title}</Text>
    </TouchableOpacity>
  );
}

function SummaryCard({summary}: {summary: Summary}) {
  return (
    <TouchableOpacity style={styles.summaryCard} activeOpacity={0.7}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryTitle}>{summary.title}</Text>
        <Text style={styles.summaryDur}>{summary.dur}</Text>
      </View>
      <Text style={styles.summaryTime}>{summary.time} · 源自录音</Text>
      <Text style={styles.summaryAbstract} numberOfLines={3}>{summary.abstract}</Text>
      <View style={styles.summaryFooter}>
        <View style={styles.summaryBadgeTeal}>
          <Text style={styles.summaryBadgeTealText}>提醒 {summary.todoN}</Text>
        </View>
        <View style={styles.summaryBadgeGold}>
          <Text style={styles.summaryBadgeGoldText}>决定 {summary.decN}</Text>
        </View>
        <Text style={styles.summaryExpand}>看原始数据 ›</Text>
      </View>
    </TouchableOpacity>
  );
}

function TodoItem({
  todo,
  onToggle,
  onEdit,
}: {
  todo: Todo;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const priColors: Record<string, string> = {高: '#C8794A', 中: '#3F8A82', 低: '#9DA295'};
  const c = priColors[todo.pri] || '#9DA295';

  return (
    <View style={styles.todoItem}>
      <TouchableOpacity
        style={[
          styles.todoCheck,
          {borderColor: todo.done ? '#7FA868' : '#D5D2C2', backgroundColor: todo.done ? '#7FA868' : '#fff'},
        ]}
        onPress={onToggle}>
        {todo.done && <Text style={{color: '#fff', fontSize: 13, fontWeight: '700'}}>✓</Text>}
      </TouchableOpacity>
      <View style={{flex: 1}}>
        <Text
          style={[
            styles.todoText,
            {color: todo.done ? '#A7AC9E' : '#28302C', textDecorationLine: todo.done ? 'line-through' : 'none'},
          ]}>
          {todo.text}
        </Text>
        <View style={styles.todoMeta}>
          <View style={[styles.priChip, {borderColor: c + '33'}]}>
            <View style={[styles.priDot, {backgroundColor: c}]} />
            <Text style={[styles.priText, {color: c}]}>{todo.pri}</Text>
          </View>
          <Text style={styles.todoTime}>{todo.time}</Text>
          <Text style={styles.todoSource}>· 来自「{todo.source}」</Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.todoEditBtn}
        onPress={onEdit}>
        <Text style={{color: '#7C8474', fontSize: 14}}>✎</Text>
      </TouchableOpacity>
    </View>
  );
}

// ──────────────────────────────────────────────
// Edit todo sheet
// ──────────────────────────────────────────────
function EditTodoSheet({
  edit,
  onClose,
  onSave,
  onDelete,
}: {
  edit: EditTodo;
  onClose: () => void;
  onSave: (e: EditTodo) => void;
  onDelete: (id: string) => void;
}) {
  const [data, setData] = useState<EditTodo>(edit);
  const isNew = !edit.id;

  const priBtn = (p: '高' | '中' | '低') => {
    const on = data.pri === p;
    return (
      <TouchableOpacity
        key={p}
        style={[
          styles.priOptionBtn,
          {backgroundColor: on ? '#DCEAE6' : '#fff', borderColor: on ? '#C9DDD7' : '#E6E1D2'},
        ]}
        onPress={() => setData(d => ({...d, pri: p}))}>
        <Text style={[styles.priOptionText, {color: on ? '#3F8A82' : '#6B7363', fontWeight: on ? '700' : '500'}]}>
          {p}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.dimOverlay} onPress={onClose} />
      <View style={styles.editSheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>{isNew ? '新建提醒' : '编辑提醒'}</Text>

        <Text style={styles.sheetLabel}>提醒内容</Text>
        <TextInput
          style={styles.sheetInput}
          value={data.text}
          onChangeText={t => setData(d => ({...d, text: t}))}
          placeholder="要提醒你做什么…"
          placeholderTextColor="#9AA095"
          multiline
        />

        <Text style={styles.sheetLabel}>时间</Text>
        <TextInput
          style={styles.sheetInput}
          value={data.time}
          onChangeText={t => setData(d => ({...d, time: t}))}
          placeholder="如 明天 14:00 / 周六"
          placeholderTextColor="#9AA095"
        />

        <Text style={styles.sheetLabel}>优先级</Text>
        <View style={styles.priRow}>{(['高', '中', '低'] as const).map(priBtn)}</View>

        <View style={styles.sheetActions}>
          {!isNew && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => { edit.id && onDelete(edit.id); }}>
              <Text style={styles.deleteBtnText}>删除</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, {flex: 1}]}
            onPress={() => onSave(data)}>
            <Text style={styles.saveBtnText}>保存</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ──────────────────────────────────────────────
// Tab panes
// ──────────────────────────────────────────────

function TimeTab() {
  const {theme} = useTheme();
  const [selectedType, setSelectedType] = useState('全部');
  const [sortAsc, setSortAsc] = useState(false);
  const s = theme.spacing;
  const r = theme.radius;

  const types = ['全部', '图片', '视频', '音频', '文字'];
  const counts: Record<string, number> = {};
  mockMedia.forEach(m => { counts[m.type] = (counts[m.type] || 0) + 1; });

  let filtered = selectedType === '全部' ? mockMedia : mockMedia.filter(m => m.type === selectedType);
  filtered = [...filtered].sort((a, b) => sortAsc ? a.ts - b.ts : b.ts - a.ts);

  return (
    <View>
      {/* Type chips + sort */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}}>
          <View style={styles.chipsContainer}>
            {types.map(t => {
              const on = t === selectedType;
              const tc = t === '全部' ? {main: '#3F8A82', soft: '#DCEAE6'} : (typeColors[t] || typeColors['图片']);
              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: on ? tc.soft : '#fff',
                      borderColor: on ? tc.main + '80' : '#E6E1D2',
                    },
                  ]}
                  onPress={() => setSelectedType(t)}>
                  <Text style={[styles.typeChipText, {color: on ? tc.main : '#6B7363', fontWeight: on ? '700' : '500'}]}>
                    {t}
                    {t !== '全部' && <Text style={{opacity: 0.7}}> {counts[t] || 0}</Text>}
                    {t === '全部' && <Text style={{opacity: 0.7}}> {mockMedia.length}</Text>}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => setSortAsc(v => !v)}>
          <Text style={styles.sortBtnText}>↕ {sortAsc ? '最早' : '最新'}</Text>
        </TouchableOpacity>
      </View>

      {/* Media grid */}
      <View style={styles.mediaGrid}>
        {filtered.map(item => {
          const tc = typeColors[item.type] || typeColors['图片'];
          const isPlayable = item.type === '视频' || item.type === '音频';
          return (
            <TouchableOpacity key={item.id} style={styles.mediaGridItem} activeOpacity={0.7}>
              <View style={[styles.mediaThumb, {backgroundColor: `hsl(${item.hue}, 26%, 84%)`}]}>
                <View style={styles.mediaTypeBadge}>
                  <Text style={[styles.mediaTypeText, {color: tc.main}]}>{item.type}</Text>
                </View>
                {isPlayable && (
                  <View style={styles.playIcon}>
                    <Text style={{color: '#fff', fontSize: 10}}>▶</Text>
                  </View>
                )}
              </View>
              <Text style={styles.mediaTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.mediaWhen}>{item.when}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 时光机 */}
      <View style={styles.timeMachineHeader}>
        <Text style={styles.timeMachineTitle}>时光机 · 回到那一天</Text>
        <Text style={styles.timeMachineSub}>按季节</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayHList}>
        {mockDays.map(day => <DayHCard key={day.id} day={day} />)}
      </ScrollView>

      {/* 线索 */}
      <View style={[styles.clueCard, {marginBottom: 14}]}>
        <View style={styles.clueHeader}>
          <StarIcon size={18} color="#3F8A82" />
          <Text style={styles.clueTitle}>线索 · 光帮你串起来的</Text>
        </View>
        <View style={styles.clueTags}>
          {[
            {label: '6神（兔子）', count: 38, bg: '#DCEAE6', border: '#C9DDD7', c: '#3F8A82'},
            {label: '家人', count: 21, bg: '#E8EEDD', border: '#D8E2C9', c: '#7FA868'},
            {label: '滨河绿道', count: 12, bg: '#DCEAE6', border: '#C9DDD7', c: '#3F8A82'},
            {label: '产品研发', count: 9, bg: '#F2E6D4', border: '#E7D5BC', c: '#C2803C'},
          ].map(tag => (
            <TouchableOpacity
              key={tag.label}
              style={[styles.clueTag, {backgroundColor: tag.bg, borderColor: tag.border}]}>
              <Text style={styles.clueTagText}>{tag.label}</Text>
              <Text style={[styles.clueTagCount, {color: tag.c}]}>{tag.count}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

function SummaryTab() {
  return (
    <View>
      {mockSummaries.map(s => <SummaryCard key={s.id} summary={s} />)}
    </View>
  );
}

function TodoTab() {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [editTodo, setEditTodo] = useState<EditTodo | null>(null);
  const doneCount = todos.filter(t => !t.done).length;

  const toggleTodo = (id: string) =>
    setTodos(prev => prev.map(t => t.id === id ? {...t, done: !t.done} : t));

  const openNew = () =>
    setEditTodo({id: null, text: '', time: '', pri: '中', source: '手动'});

  const openEdit = (todo: Todo) =>
    setEditTodo({id: todo.id, text: todo.text, time: todo.time, pri: todo.pri, source: todo.source});

  const handleSave = (e: EditTodo) => {
    if (!e.text.trim()) return;
    setTodos(prev => {
      if (e.id) return prev.map(t => t.id === e.id ? {...t, text: e.text.trim(), time: e.time || '未定时间', pri: e.pri} : t);
      const newTodo: Todo = {id: 't' + Date.now(), text: e.text.trim(), time: e.time || '未定时间', pri: e.pri, source: e.source, done: false};
      return [newTodo, ...prev];
    });
    setEditTodo(null);
  };

  const handleDelete = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
    setEditTodo(null);
  };

  return (
    <View>
      <View style={styles.todoHeader}>
        <Text style={styles.todoCount}>还有 {doneCount} 条提醒 · 光从你的记忆里提取的</Text>
        <TouchableOpacity style={styles.newTodoBtn} onPress={openNew}>
          <Text style={styles.newTodoBtnText}>+ 新建</Text>
        </TouchableOpacity>
      </View>
      {todos.map(todo => (
        <TodoItem
          key={todo.id}
          todo={todo}
          onToggle={() => toggleTodo(todo.id)}
          onEdit={() => openEdit(todo)}
        />
      ))}
      {editTodo && (
        <EditTodoSheet
          edit={editTodo}
          onClose={() => setEditTodo(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </View>
  );
}

// ──────────────────────────────────────────────
// Main screen
// ──────────────────────────────────────────────
export function MemoriesScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('time');
  const s = theme.spacing;
  const r = theme.radius;

  const tabs: {key: Tab; label: string}[] = [
    {key: 'time', label: '时光'},
    {key: 'summary', label: '纪要'},
    {key: 'todo', label: '提醒'},
  ];

  return (
    <View style={[styles.container, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{paddingBottom: 100}}
        showsVerticalScrollIndicator={false}>

        <FadeUpView>
          <View style={[styles.header, {paddingTop: insets.top + s.md + 10, paddingHorizontal: s.lg}]}>
            <Text style={[styles.headerTitle, {color: theme.colors.text}]}>记忆</Text>
          </View>
        </FadeUpView>

        <FadeUpView delay={100}>
          <View style={[styles.tabBar, {
            marginHorizontal: s.lg,
            marginTop: s.md,
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: r.md,
            padding: 4,
          }]}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tabBtn, {
                    backgroundColor: isActive ? theme.colors.bgCard : 'transparent',
                    borderRadius: r.sm + 3,
                  }]}
                  onPress={() => setActiveTab(tab.key)}>
                  <Text style={[styles.tabBtnText, {
                    color: isActive ? theme.colors.text : theme.colors.textMuted,
                    fontWeight: isActive ? '700' : '500',
                  }]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </FadeUpView>

        <FadeUpView delay={200} style={{marginHorizontal: s.lg, marginTop: s.md}}>
          {activeTab === 'time' && <TimeTab />}
          {activeTab === 'summary' && <SummaryTab />}
          {activeTab === 'todo' && <TodoTab />}
        </FadeUpView>
      </ScrollView>
    </View>
  );
}

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {flex: 1},
  scrollView: {flex: 1},
  header: {paddingBottom: 4},
  headerTitle: {fontSize: 25, fontWeight: '700'},
  tabBar: {flexDirection: 'row'},
  tabBtn: {flex: 1, paddingVertical: 9, alignItems: 'center'},
  tabBtnText: {fontSize: 13},
  // Filter row
  filterRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14},
  chipsContainer: {flexDirection: 'row', gap: 6},
  typeChip: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  typeChipText: {fontSize: 12},
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E6E1D2',
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 0,
  },
  sortBtnText: {fontSize: 11.5, fontWeight: '600', color: '#3F8A82'},
  // Media grid
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 26,
  },
  mediaGridItem: {
    width: (SCREEN_WIDTH - 80) / 2,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 18,
    padding: 9,
  },
  mediaThumb: {
    height: 96,
    borderRadius: 13,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'flex-end',
  },
  mediaTypeBadge: {
    position: 'absolute',
    top: 7,
    left: 7,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  mediaTypeText: {fontSize: 10, fontWeight: '700'},
  playIcon: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(19,23,15,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaTitle: {fontSize: 13, color: '#28302C', fontWeight: '600', marginTop: 8, lineHeight: 18},
  mediaWhen: {fontSize: 10.5, color: '#9AA095', marginTop: 3},
  // 时光机
  timeMachineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  timeMachineTitle: {fontSize: 16, fontWeight: '600', color: '#28302C'},
  timeMachineSub: {fontSize: 11.5, color: '#9AA095'},
  dayHList: {
    paddingBottom: 6,
    paddingRight: 20,
    gap: 11,
    marginBottom: 24,
    marginLeft: 0,
    marginRight: -20,
  },
  dayHCard: {
    width: 150,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 18,
    padding: 10,
  },
  dayHThumb: {
    height: 92,
    borderRadius: 13,
    justifyContent: 'flex-end',
    padding: 7,
  },
  dayThumbLabel: {
    fontSize: 9,
    fontFamily: 'ui-monospace',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  dayHInfo: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9},
  daySeasonBadge: {borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2},
  daySeasonText: {fontSize: 10.5, fontWeight: '700'},
  dayRelText: {fontSize: 10.5, color: '#9AA095'},
  dayHTitle: {fontSize: 13, color: '#28302C', fontWeight: '600', marginTop: 5, lineHeight: 18},
  // Clue card
  clueCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 20,
    padding: 16,
  },
  clueHeader: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13},
  clueTitle: {fontSize: 16, fontWeight: '600', color: '#28302C'},
  clueTags: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  clueTag: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  clueTagText: {fontSize: 12.5, color: '#2A3B33', fontWeight: '500'},
  clueTagCount: {fontSize: 12.5, fontWeight: '700', marginLeft: 4},
  // Summary
  summaryCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },
  summaryHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  summaryTitle: {fontSize: 17, fontWeight: '600', color: '#28302C'},
  summaryDur: {fontSize: 11.5, color: '#9AA095', fontVariant: ['tabular-nums'] as any},
  summaryTime: {fontSize: 12, color: '#9AA095', marginTop: 4},
  summaryAbstract: {fontSize: 13, color: '#6B7363', lineHeight: 20, marginTop: 9},
  summaryFooter: {flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12},
  summaryBadgeTeal: {backgroundColor: '#DCEAE6', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4},
  summaryBadgeTealText: {fontSize: 11, fontWeight: '700', color: '#3F8A82'},
  summaryBadgeGold: {backgroundColor: '#F2E6D4', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4},
  summaryBadgeGoldText: {fontSize: 11, fontWeight: '700', color: '#C2803C'},
  summaryExpand: {flex: 1, textAlign: 'right', fontSize: 12, color: '#3F8A82', fontWeight: '600'},
  // Todo
  todoHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11},
  todoCount: {fontSize: 12.5, color: '#9AA095'},
  newTodoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCEAE6',
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  newTodoBtnText: {fontSize: 12, fontWeight: '700', color: '#3F8A82'},
  todoItem: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    alignItems: 'flex-start',
    gap: 12,
  },
  todoCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  todoText: {fontSize: 14, fontWeight: '600', lineHeight: 20},
  todoMeta: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap'},
  priChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  priDot: {width: 6, height: 6, borderRadius: 3},
  priText: {fontSize: 11, fontWeight: '600'},
  todoTime: {fontSize: 11.5, color: '#6B7363'},
  todoSource: {fontSize: 11, color: '#9AA095'},
  todoEditBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EAE5D7',
    backgroundColor: '#F5F3EC',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Edit sheet
  dimOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(28,32,26,0.48)',
  },
  editSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F3F1E9',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    paddingBottom: 34,
  },
  sheetHandle: {
    width: 38,
    height: 5,
    borderRadius: 5,
    backgroundColor: '#D5D2C2',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {fontSize: 18, fontWeight: '600', color: '#28302C', textAlign: 'center', marginBottom: 18},
  sheetLabel: {fontSize: 12, color: '#9AA095', marginBottom: 7},
  sheetInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E6E1D2',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 13,
    fontSize: 14,
    color: '#28302C',
    marginBottom: 14,
  },
  priRow: {flexDirection: 'row', gap: 8, marginBottom: 20},
  priOptionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 13,
    paddingVertical: 11,
    alignItems: 'center',
  },
  priOptionText: {fontSize: 13},
  sheetActions: {flexDirection: 'row', gap: 10},
  deleteBtn: {
    borderWidth: 1,
    borderColor: '#E7D2CB',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {fontSize: 14, fontWeight: '700', color: '#C0584A'},
  saveBtn: {
    backgroundColor: '#3F8A82',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {fontSize: 15, fontWeight: '700', color: '#fff'},
});
