/**
 * 功能开关。惯例同 WifiManage.tsx 的 WIFI_CH_SUPPORTED：底层代码留着，入口先关。
 */

/**
 * 会员套餐 / 加购算力包入口。v1.0 关闭 —— 全部功能免费开放。
 *
 * 为什么关：MembershipPage / PowerStorePage 的下单走 createCommerceOrder → manager-api → 支付宝，
 * 而 App 内出售数字内容必须走 Apple 内购（App Store 审核指南 3.1.1）。1.0(12) 已因"有订阅字样
 * 但未提交内购产品"被判 2.1(b)；若照拒信字面去补提交内购产品，会因支付渠道对不上转而撞 3.1.1。
 *
 * 打开之前必须先做完：StoreKit 2 接入 + 后端 Apple 收据校验 + App Store Server Notifications
 * （commerce 模块需新增 Apple 渠道），并在 App Store Connect 建好订阅产品与 App Review 截图。
 *
 * 打开后即恢复：ProfilePage 会员横幅与算力补充卡、AppDrawer 的「升级」入口。
 * 屏幕与路由本身一直在（Root.tsx / nav.tsx），仅入口受本开关控制。
 */
export const SUBSCRIPTION_ENABLED = false;
