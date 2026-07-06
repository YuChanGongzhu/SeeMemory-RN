import type {
  MemorySummaryCard, MemorySummaryDetail, MemorySummaryTimeline, SummaryTimelineEntry,
} from '../requests/summaries';
import type {TopicArchive, TimelineRecord} from '../../types/memory';

const TYPE_TAG: Record<string, '人物' | '项目' | '话题'> = {
  person: '人物',
  event: '项目',
  time: '话题',
};

/** 'YYYY-MM-DD HH:MM:SS' / ISO → 'HH:MM'；取不到就原样返回。 */
function hhmm(ts: string): string {
  const m = ts?.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : ts || '';
}

/** 总结列表卡 → 沉淀档案（topicSummary 屏所需）。topicGroups/keywords 需详情接口补全。 */
export function summaryCardToArchive(c: MemorySummaryCard): TopicArchive {
  return {
    id: c.summary_id,
    tag: TYPE_TAG[c.summary_type] || '话题',
    entity: c.target_labels?.[0] || c.title,
    title: c.title,
    date: (c.created_at || '').slice(0, 10).replace(/-/g, '.'),
    count: c.segment_count,
    timespan: c.period_type,
    auraColor: c.summary_type === 'person' ? '#BF5AF2' : '#0A84FF',
    insight: c.brief,
    keywords: [],
    topicGroups: [],
  };
}

/**
 * 用总结详情（+ 可选时序记忆线）构建档案。
 * 关键：把 `/summary/{id}/timeline` 桶里的真实 sessions（含 content）按 session_id 匹配回
 * detail.timeline 各节点的 session_ids，塞进 drillDownCard.timelineRecords，钻进去才能看到碎片。
 */
export function summaryDetailToArchive(
  detail: MemorySummaryDetail,
  timeline?: MemorySummaryTimeline,
): TopicArchive {
  const base = summaryCardToArchive(detail);

  // 汇总所有桶内条目，按 session_id 建索引。
  const bySession = new Map<string, SummaryTimelineEntry>();
  (timeline?.buckets || []).forEach(b =>
    (b.entries || []).forEach(e => {
      if (e.session_id) bySession.set(e.session_id, e);
    }),
  );

  const topicGroups = (detail.timeline || []).map((t, i) => {
    const entries = (t.session_ids || [])
      .map(id => bySession.get(id))
      .filter((e): e is SummaryTimelineEntry => !!e);
    const records: TimelineRecord[] = entries.map((e, j) => ({
      id: j,
      time: hhmm(e.timestamp),
      type: 'text',
      content: e.content,
    }));
    return {
      id: `${base.id}_${i}`,
      timeRange: t.anchor,
      title: t.content,
      count: t.session_count,
      drillDownCard: {
        id: `${base.id}_${i}`,
        type: 'memory' as const,
        tag: base.tag,
        time: t.anchor,
        title: t.content,
        aiSummary: t.content,
        hasAI: true,
        timelineRecords: records.length ? records : undefined,
      },
    };
  });

  return {
    ...base,
    insight: detail.reflection || detail.brief || base.insight,
    keywords: detail.keywords || [],
    topicGroups,
  };
}
