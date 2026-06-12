import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
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

const seasonColors: Record<string, {main: string; soft: string}> = {
  '春': {main: '#7FA868', soft: '#E8EEDD'},
  '夏': {main: '#3F8A82', soft: '#DCEAE6'},
  '秋': {main: '#C2803C', soft: '#F2E6D4'},
  '冬': {main: '#7C92A6', soft: '#E4E9EE'},
};

const mockDays: Day[] = [
  {id: 'd1', date: '2026年6月11日', rel: '昨天', title: '写贪吃蛇代码的那天', season: '夏', hue: 178},
  {id: 'd2', date: '2026年6月7日', rel: '上周日', title: '海边，风很大', season: '夏', hue: 196},
  {id: 'd3', date: '2026年5月20日', rel: '上个月', title: '她第一次喊"妈妈"', season: '春', hue: 96},
  {id: 'd4', date: '2025年6月12日', rel: '去年今天', title: '同一条河堤，那时还冷', season: '春', hue: 128},
  {id: 'd5', date: '2025年12月20日', rel: '去年冬天', title: '初雪，窗上全是雾', season: '冬', hue: 212},
  {id: 'd6', date: '2025年10月18日', rel: '去年秋天', title: '银杏铺满了整条路', season: '秋', hue: 42},
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

const seasonChips = ['全部', '春', '夏', '秋', '冬'];

function DayCard({day, theme}: {day: Day; theme: Theme}) {
  const colors = seasonColors[day.season] || seasonColors['夏'];
  const r = theme.radius;

  return (
    <TouchableOpacity
      style={[localStyles.dayCard, {
        backgroundColor: theme.colors.bgCard,
        borderColor: theme.colors.border,
        borderRadius: r.lg,
      }]}
      activeOpacity={0.7}>
      <View style={[localStyles.dayThumb, {
        backgroundColor: `hsl(${day.hue}, 26%, 84%)`,
        borderRadius: r.md + 2,
      }]}>
        <Text style={[localStyles.dayThumbLabel, {color: `hsl(${day.hue}, 24%, 35%)`}]}>
          {day.rel}
        </Text>
      </View>
      <View style={localStyles.dayInfo}>
        <View style={[localStyles.dayBadge, {backgroundColor: colors.soft}]}>
          <Text style={[localStyles.dayBadgeText, {color: colors.main}]}>
            {day.season}
          </Text>
        </View>
        <Text style={[localStyles.dayRel, {color: theme.colors.textMuted}]}>
          {day.rel}
        </Text>
      </View>
      <Text style={[localStyles.dayTitle, {color: theme.colors.text}]} numberOfLines={2}>
        {day.title}
      </Text>
    </TouchableOpacity>
  );
}

function SummaryCard({summary, theme}: {summary: Summary; theme: Theme}) {
  const r = theme.radius;
  const s = theme.spacing;

  return (
    <TouchableOpacity
      style={[localStyles.summaryCard, {
        backgroundColor: theme.colors.bgCard,
        borderColor: theme.colors.border,
        borderRadius: r.lg,
        padding: s.lg,
      }]}
      activeOpacity={0.7}>
      <View style={localStyles.summaryHeader}>
        <Text style={[localStyles.summaryTitle, {color: theme.colors.text}]}>
          {summary.title}
        </Text>
        <Text style={[localStyles.summaryDur, {color: theme.colors.textMuted, fontFamily: theme.fonts.mono}]}>
          {summary.dur}
        </Text>
      </View>
      <Text style={[localStyles.summaryTime, {color: theme.colors.textMuted}]}>
        {summary.time}
      </Text>
      <Text style={[localStyles.summaryAbstract, {color: theme.colors.textSecondary}]} numberOfLines={3}>
        {summary.abstract}
      </Text>
      <View style={localStyles.summaryBadges}>
        <View style={[localStyles.summaryBadge, {backgroundColor: theme.colors.accent + '18'}]}>
          <Text style={[localStyles.summaryBadgeText, {color: theme.colors.accent}]}>
            待办 {summary.todoN}
          </Text>
        </View>
        <View style={[localStyles.summaryBadge, {backgroundColor: '#C2803C18'}]}>
          <Text style={[localStyles.summaryBadgeText, {color: '#C2803C'}]}>
            决定 {summary.decN}
          </Text>
        </View>
        <Text style={[localStyles.expandLink, {color: theme.colors.accent}]}>
          展开 ›
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function TodoItem({todo, theme, onToggle}: {todo: Todo; theme: Theme; onToggle: () => void}) {
  const r = theme.radius;
  const s = theme.spacing;
  const priColors = {高: '#C8794A', 中: '#3F8A82', 低: '#9DA295'};

  return (
    <View style={[localStyles.todoItem, {
      backgroundColor: theme.colors.bgCard,
      borderColor: theme.colors.border,
      borderRadius: r.lg + 2,
      padding: s.sm + 6,
    }]}>
      <TouchableOpacity
        style={[localStyles.todoCheckbox, {
          borderColor: todo.done ? '#7FA868' : '#D5D2C2',
          backgroundColor: todo.done ? '#7FA868' : 'transparent',
        }]}
        onPress={onToggle}>
        {todo.done && <Text style={localStyles.checkmark}>✓</Text>}
      </TouchableOpacity>
      <View style={localStyles.todoContent}>
        <Text style={[localStyles.todoText, {
          color: todo.done ? theme.colors.textMuted : theme.colors.text,
          textDecorationLine: todo.done ? 'line-through' : 'none',
        }]}>
          {todo.text}
        </Text>
        <View style={localStyles.todoMeta}>
          <View style={[localStyles.priChip, {borderColor: (priColors[todo.pri] || '#9DA295') + '33'}]}>
            <View style={[localStyles.priDot, {backgroundColor: priColors[todo.pri]}]} />
            <Text style={[localStyles.priText, {color: priColors[todo.pri]}]}>
              {todo.pri}
            </Text>
          </View>
          <Text style={[localStyles.todoTime, {color: theme.colors.textSecondary, fontFamily: theme.fonts.mono}]}>
            {todo.time}
          </Text>
          <Text style={[localStyles.todoSource, {color: theme.colors.textMuted}]}>
            · 来自「{todo.source}」
          </Text>
        </View>
      </View>
    </View>
  );
}

function TimeTab({theme}: {theme: Theme}) {
  const [selectedSeason, setSelectedSeason] = useState('全部');
  const s = theme.spacing;
  const r = theme.radius;

  const filteredDays = selectedSeason === '全部'
    ? mockDays
    : mockDays.filter(d => d.season === selectedSeason);

  return (
    <View>
      {/* Season chips */}
      <View style={localStyles.seasonRow}>
        {seasonChips.map((season) => {
          const isActive = season === selectedSeason;
          const colors = seasonColors[season];
          return (
            <TouchableOpacity
              key={season}
              style={[localStyles.seasonChip, {
                backgroundColor: isActive ? (colors?.soft || theme.colors.bgSecondary) : theme.colors.bgCard,
                borderColor: isActive ? (colors?.main || theme.colors.accent) + '55' : theme.colors.border,
                borderWidth: 1,
              }]}
              onPress={() => setSelectedSeason(season)}>
              <Text style={[localStyles.seasonChipText, {
                color: isActive ? (colors?.main || theme.colors.accent) : theme.colors.textSecondary,
                fontWeight: isActive ? '700' : '500',
              }]}>
                {season}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Section title */}
      <Text style={[localStyles.sectionTitle, {color: theme.colors.text}]}>
        回到那一天
      </Text>

      {/* Days grid */}
      <View style={localStyles.daysGrid}>
        {filteredDays.map((day) => (
          <DayCard key={day.id} day={day} theme={theme} />
        ))}
      </View>

      {/* Clue section */}
      <View style={[localStyles.clueCard, {
        backgroundColor: theme.colors.bgCard,
        borderColor: theme.colors.border,
        borderRadius: r.lg,
        padding: s.lg,
      }]}>
        <View style={localStyles.clueHeader}>
          <StarIcon size={18} color={theme.colors.accent} />
          <Text style={[localStyles.clueTitle, {color: theme.colors.text}]}>
            线索 · 光帮你串起来的
          </Text>
        </View>
        <View style={localStyles.clueTags}>
          <View style={[localStyles.clueTag, {backgroundColor: theme.colors.accent + '18', borderColor: theme.colors.accent + '33'}]}>
            <Text style={[localStyles.clueTagText, {color: theme.colors.text}]}>6神（兔子）</Text>
            <Text style={[localStyles.clueTagCount, {color: theme.colors.accent}]}>38</Text>
          </View>
          <View style={[localStyles.clueTag, {backgroundColor: '#7FA86818', borderColor: '#7FA86833'}]}>
            <Text style={[localStyles.clueTagText, {color: theme.colors.text}]}>家人</Text>
            <Text style={[localStyles.clueTagCount, {color: '#7FA868'}]}>21</Text>
          </View>
          <View style={[localStyles.clueTag, {backgroundColor: theme.colors.accent + '18', borderColor: theme.colors.accent + '33'}]}>
            <Text style={[localStyles.clueTagText, {color: theme.colors.text}]}>滨河绿道</Text>
            <Text style={[localStyles.clueTagCount, {color: theme.colors.accent}]}>12</Text>
          </View>
          <View style={[localStyles.clueTag, {backgroundColor: '#C2803C18', borderColor: '#C2803C33'}]}>
            <Text style={[localStyles.clueTagText, {color: theme.colors.text}]}>产品研发</Text>
            <Text style={[localStyles.clueTagCount, {color: '#C2803C'}]}>9</Text>
          </View>
        </View>
      </View>

      {/* Year ago card */}
      <View style={[localStyles.yearAgoCard, {
        backgroundColor: '#E8EEDD',
        borderColor: '#D8E2C9',
        borderRadius: r.lg,
        padding: s.sm + 7,
      }]}>
        <ClockIcon size={22} color="#7FA868" />
        <View style={{flex: 1, marginLeft: 10}}>
          <Text style={[localStyles.yearAgoLabel, {color: '#5E7E4C'}]}>
            这一刻 · 去年今天
          </Text>
          <Text style={[localStyles.yearAgoText, {color: '#3C4B36'}]}>
            那天也下过一场雨，你写下"想换个城市看看"。
          </Text>
        </View>
      </View>
    </View>
  );
}

function SummaryTab({theme}: {theme: Theme}) {
  return (
    <View>
      {mockSummaries.map((summary) => (
        <SummaryCard key={summary.id} summary={summary} theme={theme} />
      ))}
    </View>
  );
}

function TodoTab({theme}: {theme: Theme}) {
  const [todos, setTodos] = useState(initialTodos);
  const s = theme.spacing;
  const doneCount = todos.filter(t => !t.done).length;

  const toggleTodo = (id: string) => {
    setTodos(prev => prev.map(t => t.id === id ? {...t, done: !t.done} : t));
  };

  return (
    <View>
      <Text style={[localStyles.todoCount, {color: theme.colors.textMuted}]}>
        还有 {doneCount} 件事 · 光从你的记忆里提取的
      </Text>
      {todos.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          theme={theme}
          onToggle={() => toggleTodo(todo.id)}
        />
      ))}
    </View>
  );
}

export function MemoriesScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>('time');
  const s = theme.spacing;
  const r = theme.radius;

  const tabs: {key: Tab; label: string}[] = [
    {key: 'time', label: '时光'},
    {key: 'summary', label: '纪要'},
    {key: 'todo', label: '待办'},
  ];

  return (
    <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        style={localStyles.scrollView}
        contentContainerStyle={{paddingBottom: 100}}
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeUpView>
          <View style={[localStyles.header, {paddingTop: insets.top + s.md + 10, paddingHorizontal: s.lg}]}>
            <Text style={[localStyles.headerTitle, {color: theme.colors.text}]}>
              记忆
            </Text>
          </View>
        </FadeUpView>

        {/* Tab Bar */}
        <FadeUpView delay={100}>
          <View style={[localStyles.tabBar, {
            marginHorizontal: s.lg,
            marginTop: s.md,
            backgroundColor: theme.colors.bgSecondary,
            borderRadius: r.md,
            padding: 4,
          }]}>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[localStyles.tab, {
                    backgroundColor: isActive ? theme.colors.bgCard : 'transparent',
                    borderRadius: r.sm + 3,
                  }]}
                  onPress={() => setActiveTab(tab.key)}>
                  <Text style={[localStyles.tabText, {
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

        {/* Tab Content */}
        <FadeUpView delay={200} style={{marginHorizontal: s.lg, marginTop: s.md}}>
          {activeTab === 'time' && <TimeTab theme={theme} />}
          {activeTab === 'summary' && <SummaryTab theme={theme} />}
          {activeTab === 'todo' && <TodoTab theme={theme} />}
        </FadeUpView>
      </ScrollView>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  scrollView: {flex: 1},
  header: {},
  headerTitle: {
    fontSize: 25,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
  },
  seasonRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 16,
  },
  seasonChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  seasonChipText: {
    fontSize: 12.5,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  dayCard: {
    width: (SCREEN_WIDTH - 80) / 2,
    borderWidth: 1,
    padding: 10,
  },
  dayThumb: {
    height: 90,
    justifyContent: 'flex-end',
    padding: 7,
  },
  dayThumbLabel: {
    fontSize: 9,
    fontFamily: 'ui-monospace',
    letterSpacing: 0.2,
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  dayInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
  },
  dayBadge: {
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dayBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  dayRel: {
    fontSize: 10.5,
  },
  dayTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 5,
    lineHeight: 18,
  },
  clueCard: {
    borderWidth: 1,
    marginBottom: 14,
  },
  clueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 13,
  },
  clueTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  clueTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  clueTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  clueTagText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  clueTagCount: {
    fontSize: 12.5,
    fontWeight: '700',
    marginLeft: 4,
  },
  yearAgoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    borderWidth: 1,
  },
  yearAgoLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  yearAgoText: {
    fontSize: 13.5,
    marginTop: 3,
    lineHeight: 19,
  },
  summaryCard: {
    borderWidth: 1,
    marginBottom: 12,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  summaryDur: {
    fontSize: 11.5,
  },
  summaryTime: {
    fontSize: 12,
    marginTop: 3,
  },
  summaryAbstract: {
    fontSize: 13,
    lineHeight: 21,
    marginTop: 9,
  },
  summaryBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
  },
  summaryBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  summaryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  expandLink: {
    flex: 1,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
  },
  todoCount: {
    fontSize: 12.5,
    marginBottom: 11,
  },
  todoItem: {
    flexDirection: 'row',
    borderWidth: 1,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  todoCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  todoContent: {flex: 1},
  todoText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  todoMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  priChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  priDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  priText: {
    fontSize: 11,
    fontWeight: '600',
  },
  todoTime: {
    fontSize: 11.5,
  },
  todoSource: {
    fontSize: 11,
  },
});
