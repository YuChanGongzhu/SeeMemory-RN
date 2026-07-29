/** Mock feed data ported from app-prototype/src/App.jsx (DEMO_MEMORIES etc.). */
import type {MemoryCard, DailyStatus, HistoricalMemory, TopicArchive, Todo} from '../types/memory';

export const MOCK_TODOS: Todo[] = [
  {id: 1, title: '饼老板下班打卡提醒', description: '给饼老板发下班打卡提醒：现在是18:35，该下班打卡了。语气是勤快大王日常风格，简短自然。', type: '周期性', time: '35 18 * * 1-5', source: 'Web', enabled: true},
  {id: 2, title: '每天喝水提醒', description: '提醒自己多喝水，保持健康。', type: '周期性', time: '每天 10:00, 14:00, 16:00', source: 'App', enabled: true},
  {id: 3, title: '明晚取快递', description: '去蜂巢快递柜取包裹', type: '一次性', time: '明天 19:30', source: '微信', enabled: false},
];

const U = (id: string) => `https://images.unsplash.com/photo-${id}?q=80&w=1200&auto=format&fit=crop`;

/**
 * 首次/空态欢迎卡。用户尚无任何真实记忆碎片时，首页只展示这一条（不再回退整套
 * DEMO_MEMORIES 演示数据）。
 */
export const WELCOME_MEMORY: MemoryCard = {
  id: 'm4', type: 'memory', tag: '公告', title: '欢迎来到 Remmy ✦',
  keyQuote: 'Remmy 的核心优势是强大的记忆检索与跨会话调用能力。', time: '今天 刚刚', hasAI: true,
  aiSummary: 'Remmy 是一款无感采集、AI 驱动的第二大脑工具。本篇是产品的核心功能说明与欢迎指引。',
  tags: ['官方公告', '产品介绍', '新手指引'],
  timelineRecords: [
    {id: 1, time: '第一步', type: 'text', content: '无感采集：无需主动触发录音，记忆在后台自动产生。'},
    {id: 2, time: '第二步', type: 'image', url: U('1618005182384-a83a8bd57fbe')},
    {id: 3, time: '第三步', type: 'text', content: '强大的自然语言搜索：你可以自然地问“上周我和谁聊过这个话题？”。'},
  ],
};

export const DEMO_MEMORIES: MemoryCard[] = [
  {
    id: 'm_text_only', type: 'memory', tag: '随笔', time: '今天 09:00',
    content: '今天早上的咖啡格外好喝，突然有了新的工作灵感，准备一会儿把它详细记录下来。',
  },
  {
    id: 'm_title_only', type: 'memory', tag: '待办', time: '今天 09:30',
    title: '提醒我下午三点拉齐 Q3 规划会',
  },
  {
    id: 'm_link', type: 'memory', tag: '阅读', time: '今天 11:00',
    content: '这篇文章深入剖析了如何构建新一代的 AI Native 交互范式，非常值得团队学习。',
    link: {title: 'AI Native 交互设计指南 - UX Design', url: 'www.design-guide.com'},
  },
  {
    id: 'm1', type: 'memory', tag: '会议', title: '关于 Q3 核心规划的头脑风暴', time: '今天 10:30', hasAI: true,
    aiSummary: '本次会议确定了 Q3 将重点发力产品体验优化，并决定开始梳理现有的客户反馈列表作为切入点。',
    tags: ['产品思考', '增长', '会议'],
    timelineRecords: [
      {id: 1, time: '10:00', isHighlight: true, clusterName: 'Q3 核心规划会议', images: [U('1531403009284-440f080d1e12')], content: '团队白板的现场照片，梳理了 Q3 的核心路径。'},
      {id: 2, time: '10:05', isHighlight: true, clusterName: 'Q3 核心规划会议', audio: {duration: '12:12', name: '核心讨论录音'}, content: '（AI 自动转写）关于 Q3 的发力点，我觉得产品体验必须是第一位。'},
      {id: 3, time: '10:30', isHighlight: true, clusterName: 'Q3 核心规划会议', doc: {name: 'Q3_Planning_Draft.pdf', size: '2.4 MB'}, images: [U('1581291518857-4e27b48ff24e')], content: '这是会议中提到的 PDF 规划文档，另外附上一张现场草图参考。'},
      {id: 4, time: '10:45', isAppended: true, content: '刚才会上说的那个转化漏斗逻辑我再想想，觉得还可以进一步精简注册流程。'},
      {id: 5, time: '11:15', isAppended: true, video: {cover: U('1611162617474-5b21e879e113'), duration: '0:45'}, images: [U('1512941937669-90a1b58e7e9c')], content: '找了一段竞品的交互演示录屏片段，外加核心截图。'},
    ],
  },
  {
    id: 'm1_1', type: 'memory', tag: '灵感', audioDuration: '1:20', title: '关于产品增长的新思路', time: '今天 14:15', hasAI: true,
    aiSummary: '突然想到可以利用“微习惯”的心理学模型，设计一套打卡奖励机制，降低用户持续记录的阻力。',
    tags: ['产品思考', '增长'],
    timelineRecords: [
      {id: 10, time: '14:10', type: 'text', content: '《微习惯》这本书里提到，把目标定到小得不可思议，就能克服拖延。'},
      {id: 11, time: '14:15', type: 'audio', duration: '1:20', name: '语音备忘', content: '（AI 自动转写）咱们是不是可以把 Remmy 的初始记录门槛降到极低？'},
    ],
  },
  {
    id: 'm1_2', type: 'memory', tag: '日常', image: U('1554118811-1e0d58224f24'), title: '极简风格的咖啡店', time: '今天 12:40', hasAI: true,
    aiSummary: '中午吃完饭发现了一家隐藏在巷子里的纯黑白灰装修咖啡店，非常符合我们的设计调性。',
    tags: ['探店', '极简设计', '放松'],
    timelineRecords: [
      {id: 20, time: '12:35', type: 'image', url: U('1554118811-1e0d58224f24')},
      {id: 21, time: '12:40', type: 'text', content: '这家店的吧台全是不锈钢和磨砂黑亚克力材质，视觉冲击力很强。'},
    ],
  },
  {
    id: 'm2', type: 'memory', tag: '生活',
    images: [U('1495360010541-f48722b34f7d'), U('1514888286974-6c03e2ca1dba'), U('1554118811-1e0d58224f24')],
    title: '下班路上的晚霞与流浪猫', time: '昨天 18:45', hasAI: true,
    aiSummary: '记录了下班路上美丽的晚霞和一只慵懒的流浪猫，心情非常治愈。',
    tags: ['生活记录', '摄影', '治愈'],
    timelineRecords: [
      {id: 1, time: '18:30', type: 'image', url: U('1495360010541-f48722b34f7d')},
      {id: 2, time: '18:32', type: 'image', url: U('1514888286974-6c03e2ca1dba')},
      {id: 3, time: '18:45', type: 'text', content: '今天下班路上看到一只流浪猫在晒太阳，懒洋洋的，突然觉得生活还挺美好的。'},
    ],
  },
  {
    id: 'm3', type: 'memory', tag: '视频', video: U('1551698618-1dfe5d97d256'), title: '周末崇礼滑雪Vlog', time: '周六 15:30', hasAI: true,
    aiSummary: '记录了一段滑雪的视频和当下的疲惫感受。虽然摔倒了很痛，但依然觉得非常开心过瘾。',
    tags: ['滑雪', 'Vlog', '周末'],
    timelineRecords: [
      {id: 1, time: '14:00', type: 'video', name: '滑雪录像.mp4'},
      {id: 2, time: '15:30', type: 'text', content: '今天摔得大腿都青了，但滑起来风驰电掣的感觉真的是太爽了！'},
    ],
  },
  WELCOME_MEMORY,
];

export const DEMO_TOPIC_ARCHIVES: TopicArchive[] = [
  {
    id: 't1', tag: '人物', entity: '李雷', title: '与李雷关于产品节奏分歧的探讨', date: '2026.06.22', count: 12, timespan: '近一个月', auraColor: '#BF5AF2',
    insight: '在过去一个月里，你与李雷共有 12 次深度讨论。核心分歧在于"是否该尽早开放公测"。他主张克制，你更看重真实反馈。最终双方在"小范围灰度"上达成共识。',
    keywords: ['产品节奏', '公测', '灰度'],
    topicGroups: [
      {
        id: 'tg1', timeRange: '6月1日 - 6月5日', title: '关于开放节奏的初次交锋', count: 4,
        drillDownCard: {
          id: 'mock_drill_t1', type: 'memory', tag: '会议', time: '今天 14:30', hasAI: true,
          aiSummary: '两人对于产品初期的开放节奏发生了激烈争论。', keyQuote: '没打磨好就放出去，引来的全都是一次性用户。', tags: ['产品节奏', '开放策略'],
          timelineRecords: [
            {id: 1, time: '14:30', type: 'audio', duration: '12:00', name: '与李雷在咖啡馆的争论'},
            {id: 2, time: '15:20', type: 'text', content: '我其实同意他的担忧，但早期用户基数不够，怎么跑通模型？'},
          ],
        },
      },
      {
        id: 'tg2', timeRange: '6月18日 - 6月20日', title: '达成「灰度」共识', count: 3,
        drillDownCard: {
          id: 'mock_drill_t2', type: 'memory', tag: '会议', time: '今天 10:00', hasAI: true,
          aiSummary: '最终确认了"先小范围灰度，再逐步放量"的底线。', tags: ['产品节奏', '共识'],
          timelineRecords: [
            {id: 1, time: '10:00', type: 'doc', doc: {name: '灰度方案草稿.pdf'}},
            {id: 2, time: '11:15', type: 'text', content: '李雷终于妥协了，灰度是最好的缓冲带。'},
          ],
        },
      },
    ],
  },
  {
    id: 't2', tag: '项目', entity: 'Q3 产品规划', title: 'Q3 核心体验重构演进史', date: '2026.06.20', count: 34, timespan: '5月-6月', auraColor: '#0A84FF',
    insight: '这 34 个碎片完整记录了从拟物化向 Neumorphism 风格转型的纠结过程。从最初的尝试阴影，到彻底抛弃厚重感走向极致黑白，这是极简理念的全面胜利。',
    keywords: ['UI重构', '黑白极简', 'Neumorphism'],
    topicGroups: [],
  },
];

export const DAILY_STATUS: DailyStatus = {
  date: '今天',
  time: '12:32 更新',
  title: '今天你有些忙，但思路很清晰',
  emotion: {focus: 65, anxiety: 20, excitement: 10, fatigue: 5},
  stats: {count: 7, diff: '+3', activePeriod: '09:30 – 11:00', topics: '工作计划 · 出行 · 饮食'},
  insight: "你今天提到了'下周'6次，看起来在认真规划近期。",
};

export const HISTORICAL_MEMORIES: HistoricalMemory[] = [
  {id: 'h1', date: '2026.06.18', title: '极其高效与专注的一天', emotion: {focus: 85, anxiety: 15, excitement: 40, fatigue: 30}, stats: {count: 18, activePeriod: '14:00 - 18:00', weekday: '周四', topics: '产品规划, API 联调'}, insight: '你今天展现了极高的心流状态，下午长达 4 小时都在进行深度工作...'},
  {id: 'h2', date: '2026.06.19', title: '充满焦虑与中断的一天', emotion: {focus: 30, anxiety: 75, excitement: 20, fatigue: 80}, stats: {count: 24, activePeriod: '10:00 - 12:00', weekday: '周五', topics: '线上 Bug, 客户投诉'}, insight: '频繁的外部打断让你今天显得格外焦虑，但最终问题都妥善解决了。'},
  {id: 'h3', date: '2026.06.20', title: '轻松愉快的休息日', emotion: {focus: 20, anxiety: 10, excitement: 85, fatigue: 15}, stats: {count: 6, activePeriod: '16:00 - 19:00', weekday: '周六', topics: '看电影, 聚餐'}, insight: '彻底脱离了工作，你的大脑和情绪得到了极大的放松与滋养。'},
];
