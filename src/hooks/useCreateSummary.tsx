import React, {createContext, useCallback, useContext, useState} from 'react';
import {useNav} from '../navigation/nav';
import {useWriteGate} from './useWriteGate';
import {CreateSummarySheet} from '../components/CreateSummarySheet';
import {summaryDetailToArchive} from '../apis/mappers/summary';
import {getMemorySummaryTimeline, type MemorySummaryDetail} from '../apis/requests/summaries';

interface CreateSummaryApi {
  /** 打开「新建总结」弹窗；游客先走登录。 */
  openCreateSummary: () => void;
}

const CreateSummaryContext = createContext<CreateSummaryApi>({openCreateSummary: () => {}});

/**
 * 挂载「新建总结」弹窗并暴露打开入口。生成成功后用 detail 直接跳到 topicSummary 详情。
 * 需在 NavProvider 内（要 nav.push）。仿 useImagePreview 的 Provider 模式。
 *
 * 只拦游客（登录态）：/app/memory/summary 走 currentUser()，按登录用户的当前记忆体
 * 生成，跟 /app/chat、fragments/search 一样不依赖客户端 selectedDevice。若后端确实没有
 * 可用记忆体，会返回错误，由弹窗内 toast 呈现。
 */
export function CreateSummaryProvider({children}: {children: React.ReactNode}) {
  const nav = useNav();
  const gate = useWriteGate();
  const [visible, setVisible] = useState(false);

  const openCreateSummary = useCallback(() => {
    gate(() => setVisible(true));
  }, [gate]);

  const onGenerated = useCallback(
    async (detail: MemorySummaryDetail) => {
      // 拉时序记忆线，让钻取卡能看到真实碎片（失败则退化为仅概要）。
      const timeline = await getMemorySummaryTimeline(detail.summary_id).catch(() => undefined);
      nav.push('topicSummary', {data: summaryDetailToArchive(detail, timeline)});
    },
    [nav],
  );

  return (
    <CreateSummaryContext.Provider value={{openCreateSummary}}>
      {children}
      <CreateSummarySheet visible={visible} onClose={() => setVisible(false)} onGenerated={onGenerated} />
    </CreateSummaryContext.Provider>
  );
}

export const useCreateSummary = () => useContext(CreateSummaryContext);
