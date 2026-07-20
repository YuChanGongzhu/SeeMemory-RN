/**
 * 记忆列表脏标记 —— 模块级单例，写操作与列表页之间的最小联动。
 *
 * 为什么需要：修正是异步的，EditorPage 提交完 nav.pop() 回到 HomeHub 时，列表还是旧数据；
 * 而 HomeHub 只在 mount 和手动刷新时拉数据。写操作在这里打标，列表页在获得焦点时消费一次。
 *
 * 为什么不用 Context/事件总线：项目没有全局 store，加一个只为传布尔值的 Provider 不划算；
 * 也不改 nav.push 签名（会波及所有调用方）。
 */

let dirty = false;

/** 写操作（新建 / 修正 / 删除）成功后调用。 */
export function markMemoryDirty(): void {
  dirty = true;
}

/** 读并清除：返回是否需要刷新。列表页获得焦点时调一次。 */
export function consumeMemoryDirty(): boolean {
  const was = dirty;
  dirty = false;
  return was;
}
