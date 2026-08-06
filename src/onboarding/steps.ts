/**
 * 新手引导（记忆粒连接 → 设置密钥 → 设备文件上传 → 自动化开关）的步骤表。
 * 纯数据，不含 JSX/逻辑；kind==='wait' 的步骤没有固定 targetId，只在
 * TourSpotlight 里退化成一张浮动提示卡，由 TourContext 监听 useMr20() 的真实
 * 业务状态自动前进（见 [[mr20-sk-binding-key]] [[mr20-account-binding-flow]]）。
 */

export type StepMount = 'root' | 'drawer';
export type StepKind = 'tap' | 'wait' | 'info';
export type WaitKey = 'connected' | 'keyBound' | 'uploadDone';

export interface TourStep {
  id: string;
  mount: StepMount;
  kind: StepKind;
  /** tap/info 步骤要高亮的真实元素 id；wait 步骤没有固定目标。 */
  targetId?: string;
  title: string;
  body: string;
  /** 目标当前没挂载（比如还在别的子页）时显示的浮动提示文案。 */
  fallbackText: string;
  waitKey?: WaitKey;
  /** 设备已绑定密钥时跳过（setup-key / wait-key 专用）。 */
  skipWhenKeyAlreadyBound?: boolean;
  /** info 步骤气泡里的按钮文案；不填默认「下一步」。 */
  ctaLabel?: string;
  /** info 步骤按钮是否直接结束引导（而不是前进到下一步）。 */
  isFinal?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'drawer-open',
    mount: 'root',
    kind: 'tap',
    targetId: 'drawer-open',
    title: '打开侧边栏',
    body: '点这里打开侧边栏，去连接你的记忆粒',
    fallbackText: '点左上角图标打开侧边栏',
  },
  {
    id: 'drawer-mr20',
    mount: 'drawer',
    kind: 'tap',
    targetId: 'drawer-mr20',
    title: '进入记忆粒',
    body: '点「记忆粒」进入设备页',
    fallbackText: '点「记忆粒」进入设备页',
  },
  {
    id: 'connect-device',
    mount: 'root',
    kind: 'tap',
    targetId: 'connect-device',
    title: '连接记忆粒',
    body: '点这里连接你的记忆粒',
    fallbackText: '点连接按钮，开始连接记忆粒',
  },
  {
    id: 'wait-connect',
    mount: 'root',
    kind: 'wait',
    waitKey: 'connected',
    title: '连接中',
    body: '正在连接记忆粒，请稍候…',
    fallbackText: '正在连接记忆粒，请稍候…',
  },
  {
    id: 'setup-key',
    mount: 'root',
    kind: 'tap',
    targetId: 'setup-key',
    title: '设置密钥',
    body: '这台设备还没绑定，点这里设置一把专属密钥',
    fallbackText: '点「设置密钥」完成设备绑定',
    skipWhenKeyAlreadyBound: true,
  },
  {
    id: 'wait-key',
    mount: 'root',
    kind: 'wait',
    waitKey: 'keyBound',
    title: '设置密钥中',
    body: '完成设置后点返回即可，这里会自动继续引导',
    fallbackText: '完成密钥设置后点返回，引导会自动继续',
    skipWhenKeyAlreadyBound: true,
  },
  {
    id: 'device-files',
    mount: 'root',
    kind: 'tap',
    targetId: 'device-files',
    title: '设备文件',
    body: '点这里浏览记忆粒上的录音文件',
    fallbackText: '点「设备文件」浏览录音',
  },
  {
    id: 'select-files',
    mount: 'root',
    kind: 'tap',
    targetId: 'select-files',
    title: '选中录音',
    body: '勾选想要同步的录音，或直接点全选',
    fallbackText: '勾选录音，或点「全选」',
  },
  {
    id: 'upload-files',
    mount: 'root',
    kind: 'tap',
    targetId: 'upload-files',
    title: '手动上传',
    body: '点「蓝牙上传」把选中的录音传到手机',
    fallbackText: '点「蓝牙上传」开始传输',
  },
  {
    id: 'wait-upload',
    mount: 'root',
    kind: 'wait',
    waitKey: 'uploadDone',
    title: '传输中',
    body: '正在传输录音，完成后会自动回到主页…',
    fallbackText: '正在传输录音，请稍候…',
  },
  {
    id: 'view-recordings',
    mount: 'root',
    kind: 'info',
    targetId: 'view-recordings',
    title: '我的录音',
    body: '刚同步的录音会出现在这里，可以直接播放',
    fallbackText: '在「我的录音」里查看刚同步的录音',
    ctaLabel: '下一步',
  },
  {
    id: 'ask-automation',
    mount: 'root',
    kind: 'info',
    targetId: 'ask-automation',
    title: '自动同步 / 自动转文字',
    body: '要不要开启？开启后新录音会自动下载、自动转写，你也可以现在先跳过，之后随时来这里开',
    fallbackText: '要不要开启自动同步 / 自动转文字？',
    ctaLabel: '完成引导',
    isFinal: true,
  },
];
