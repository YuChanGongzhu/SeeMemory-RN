/** Data model for the Remmy feed — shaped after the app-prototype mocks. */

export interface LinkPreview {
  title: string;
  url: string;
}

export interface TimelineRecord {
  id: number;
  time: string; // 'HH:MM' or a step label like '第一步'
  type?: 'audio' | 'video' | 'image' | 'text' | 'doc' | 'group';
  isHighlight?: boolean;
  isAppended?: boolean;
  clusterName?: string;
  content?: string;
  audio?: {duration: string; name: string};
  video?: {cover?: string; url?: string; duration?: string};
  images?: string[];
  url?: string; // for type image/video shorthand
  name?: string;
  duration?: string;
  doc?: {name: string; size?: string};
  /** 仅后端真实 timeline 节点携带；合成媒体节点没有编辑目标。 */
  timelineTarget?: TimelineEditTarget;
}

export interface TimelineEditTarget {
  index: number;
  time: string;
  type: 'audio' | 'video' | 'image' | 'text' | 'doc';
  content: string;
  mediaIds: string[];
}

export interface MemoryCard {
  id: string;
  /**
   * 真实后端碎片 id —— **只有** fragmentToCard 产出的卡片才有。
   *
   * `id` 不可信：欢迎卡（'m4'）、演示数据、事件钻取合成卡（`event_*`）、mock 钻取卡
   * 都会填 id，把它们当锚点发给 /app/memory/corrections 必然 404。写操作一律判本字段，
   * 不要去猜 id 前缀——那是黑名单，加一种合成卡就漏一次。
   */
  fragmentId?: string;
  /** 后端 optimistic-concurrency 版本，必须保留完整秒级字符串。 */
  fragmentUpdateTime?: string;
  type: 'memory';
  tag: string;
  tagColor?: string;
  time: string; // e.g. '今天 09:00' / '昨天 18:45' / '周六 15:30'
  title?: string;
  content?: string;
  aiSummary?: string;
  keyQuote?: string;
  hasAI?: boolean;
  tags?: string[];
  link?: LinkPreview;
  image?: string;
  images?: string[];
  video?: string;
  audioDuration?: string;
  updateTime?: string;
  audioCount?: number;
  timelineRecords?: TimelineRecord[];
}

export interface Emotion {
  focus: number;
  anxiety: number;
  excitement: number;
  fatigue: number;
}

export interface DailyStatus {
  date: string;
  time: string;
  title: string;
  emotion: Emotion;
  stats: {count: number; diff: string; activePeriod: string; topics: string};
  insight: string;
  // 真实数据（来自 mood 接口 detail）；缺省时详情页回落内置示例。
  heatmap?: number[];
  eventRecall?: {time_range: string; title: string; count: number; event_ids?: string[]; fragment_ids?: string[]}[];
}

export interface Todo {
  id: string | number;
  title: string;
  description: string;
  type: '一次性' | '周期性';
  time: string;
  source: 'Web' | 'App' | '微信';
  enabled: boolean;
}

export interface TopicGroup {
  id: string;
  timeRange: string;
  title: string;
  count: number;
  drillDownCard: MemoryCard;
}

export interface TopicArchive {
  id: string;
  tag: '人物' | '项目' | '话题';
  entity: string;
  title: string;
  date: string;
  count: number;
  timespan: string;
  auraColor: string;
  insight: string;
  keywords: string[];
  topicGroups: TopicGroup[];
}

export interface HistoricalMemory {
  id: string;
  date: string;
  title: string;
  emotion: Emotion;
  stats: {count: number; activePeriod: string; weekday: string; topics: string};
  insight: string;
  heatmap?: number[];
}
