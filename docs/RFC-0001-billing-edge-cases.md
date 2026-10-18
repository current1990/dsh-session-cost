# RFC-0001：计费边界情况（子代理 / 会话内切换模型 / 未知计价）

- 状态：草案（待定）
- 日期：2026-10-18
- 影响组件：`dsh-session-cost`（宿主侧投影 `sessionCost`、客户端读数）

## 1. 背景与现状

插件用宿主侧 session projection 折叠会话日志：

- **数据源**：本会话日志中的 `assistant/message`（携带 `usage`）与 `request/context`（携带 `provider` / `model`）；
- **计价**：按事件 `time` 选价格区间（`ERAS`），区内按北京时间判定峰谷（`isPeak`）；
- **价格键**：`model` 字符串，未命中则用 `FALLBACK_RATES`（当前 flash 价）；
- **状态**：累计 token 与费用（`costCny` / `costPeak` / `costOffPeak` / `costByEra`），`stateVersion: 2`。

已知两个计费语义问题：子代理会话的用量不进入父会话读数；会话内切换模型（尤其切到无官方定价的渠道）存在静默偏差。

## 2. 问题一：子代理调用不计入父会话

### 2.1 现象

子代理（`subagent` / `spawn_teammate` / workflow 的 `agent()`）真实产生模型调用与费用，但父会话 dock 的读数**不包含**它们。

### 2.2 实测（本机 `AgentRoot` 会话族）

| 会话 | 调用次数 | 费用 |
| --- | --- | --- |
| 父会话 `session-6a1a62a3…` | 58 | **¥0.2546**（插件读数） |
| 子代理 `077fe43e…`（`origin: subagent`，depth 1） | 1 | ¥0.0140 |
| 子代理 `218dcfaf…`（`origin: subagent`，depth 1） | 1 | ¥0.0015 |
| 会话族合计 | 60 | ¥0.2701（子代理占 5.7%） |

### 2.3 根因

子代理是**独立会话**：自己的 `sessionId`、自己的日志文件，头部带 `origin: "subagent"`、`parentSession`、`delegationDepth`。投影单元只读**本会话**日志，父会话日志里只有"子代理返回的 tool 结果文本"（该文本的 token 记在父会话自己头上，不重复计费），没有子代理的 `assistant/message`。

每个子会话**自己**有独立的 `sessionCost` 值：在 UI 里打开子会话会显示它自己的费用。

### 2.4 可选方案

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 文案澄清 | tooltip/说明标注"不含子代理会话" | 零成本、无误差（明确说明不完整） | 用户仍需逐个打开会话查看 |
| B. 客户端近似合计 | `useSessions` 找 `parentSession === sessionId` 的子会话，累加其投影值 | 只改客户端 | 客户端 store 通常只有已打开/订阅过的会话有投影值，未打开的拿不到 → 大概率不完整 |
| C. 宿主侧会话族索引 + 额外通道 | 监听 `subagent/start`/`subagent/end`（或扫描会话列表），维护"父 → 子树合计"，用额外投影 key 或 Remote 服务提供 | 完整、可展示"整族花费" | 引入跨会话状态与一次 RPC/额外 key；需要处理子会话已结束/重启后的重建 |

**建议**：先落地 A（保证语义诚实）；C 只在确实需要"整族费用"时再做，且要与会话持久化对齐（重启后重建子树索引）。B 不建议单独采用，因为它给出的是"有时完整、有时不完整"的数字。

## 3. 问题二：会话内切换模型

### 3.1 现状：模型切换本身是正确的

`request/context` 在路由（provider/model）或容量变化时写入日志，折叠按每条 `assistant/message` **当时的** route 计价。

本会话实测：2 次 route 变化 ——

```
08-13 21:23:54  deepseek-official / deepseek-v4-pro   (147 次调用)
10-18 11:51:02  deepseek-account  / deepseek-flash    (65 次调用)
```

独立重放确认：147 次按 v4-pro 旧价、65 次按 flash 新价，合计 ¥4.2426 与逐条手工核对一致。**切换模型不会串价，也不会重复计费。**

### 3.2 缺口 1：`provider` 未参与计价（重要）

`request/context` 同时携带 `provider`，但插件只用 `model` 查价（`index.js:92`）。同一个 model id 在不同渠道可能有完全不同的价格（官方 vs 三方网关），当前实现无法区分，会按 model 的官方价计。

**方案**：价格键改为 `provider` + `model`（或 `provider/model` 字符串），价格表结构支持"每渠道覆盖 + 官方兜底"。需要 `stateVersion` 递增（状态新增 provider 字段，旧检查点作废并重算）。

### 3.3 缺口 2：首调用缺 route 时静默用兜底价

若 `assistant/message` 之前没有 `request/context`（恢复/特殊路径），`state.model` 为空，`priceUsage` 落进 `FALLBACK_RATES`，偏差不可见。

**方案**：将"缺 route"的调用计入 `unpricedCalls`（见 3.4），而不是静默按 flash 计价；或在 `init` 时从会话 header / 历史 header 恢复最近一次 route（需要 host 侧读取，投影只能看事件，故仍推荐前者）。

### 3.4 缺口 3：无定价信息的渠道（非官方渠道）静默按 flash 计价

用户把模型切到非官方渠道（自定义 baseURL、pi-ai 等），或使用插件价格表里没有的 model id 时，当前行为是**按 flash 价估算**，无任何提示：

- 若渠道免费/极便宜 → 读数虚高；
- 若模型比 flash 贵（如大模型中转）→ 读数低估；
- 两种情况下用户都无法从界面上发现问题。

**方案**：引入显式的 "unpriced" 语义：

1. 未命中价格表的调用：**token 照常累计**，但**金额不再累加**，同时累加 `unpricedCalls` / `unpricedTokens`；
2. `wire.view` 暴露这两个字段，读数显示为 `≈¥x（N 次未计价）` 或 `¥x + ?`（具体文案见 §5）；
3. 提供开关（后续可做成 Config）：`unknownPricing: 'unpriced' | 'estimate-flash'`，默认 `unpriced`（诚实优先），需要粗略估计的用户可切到 `estimate-flash`。

这样"有价格的部分准确、没价格的部分显式标注"，而不是把不确定藏进一个看起来精确的数字。

### 3.5 其他相关约束

- 峰谷判定只对 `2026-10-17` 起的区间生效；更早区间 `peak === off`；
- 缓存写按未命中价计（与官方口径一致，若渠道报价不同需在 3.2 的渠道表中体现）；
- `reasoning` token 不单独加价（已包含在输出价内），仅作展示。

## 4. 兼容性与实现要点

| 变更 | 影响 | 处理 |
| --- | --- | --- |
| 状态新增 `provider` / `unpriced*` 字段 | 旧检查点失效 | `stateVersion` 2 → 3，框架自动整段重算 |
| `wire.view` 新增字段 | 客户端若未同步会读不到 | 客户端需容错（缺失按 0），与现有 `costByEra` 的处理一致 |
| 价格表结构变化 | 现有 `ERAS[].models` 需扩展为按渠道 | 保持"model 兜底 + provider 覆盖"的合并顺序 |

## 5. 待决问题

1. 读数文案：`≈¥0.42（2 次未计价）` vs `¥0.42 + ?` vs 完全隐藏金额？倾向第一种。
2. 子代理聚合（方案 C）是否值得做，是否需要"整族"与"仅本会话"两个开关？
3. 非官方渠道是否应支持用户手工补价（写入插件价格表 / Config）？考虑到换电脑会丢配置，倾向"写进代码仓库的价格表"。
4. 汇率：若以后出现美元计价的渠道，是否需要在表里带币种并统一折算？

## 6. 验收方式

- 单测：未知模型 → 金额不增、`unpricedCalls` +1；切换 provider 同名 model → 分别计价；首调用无 route → 计入 unpriced；
- 日志重放：对已有会话族跑一遍，父会话 + 子会话分别与手工核对一致；
- 界面：读数在"全部已计价"与"含未计价"两种情况下文案正确。

## 7. 决策记录

2026-10-18 决定并已实现（`0.3.0`）：

- **§2 子代理**：采用"状态栏聚合 + 点击展开树状面板"，而不是逐会话文案澄清。树来自父日志中持久化的 `subagent/catalog` 事件（`childId` / `label` / `mode`），子会话费用通过其自身投影状态读取；已结束的子会话标记为"未加载"、不计入合计。
- **§3.2 渠道**：暂时只认定 DeepSeek 官方与账号两个渠道（`deepseek-official`、`deepseek-account`），其余渠道一律按未计价处理。
- **§3.4 未计价语义**：采纳默认 `unpriced` —— token 照常累计、金额不累加，`unpricedCalls` / `unpricedTokensIn` / `unpricedTokensOut` 进入 `wire.view`，读数显示"未计价"。
- **§2 方案 C（宿主侧持久子树索引）**：暂不排期；如需要"重启后仍包含已结束子会话"的整族金额，再评估读取持久化的方案。
- **§3.3（首调用缺 route）**：随 `provider` 加入状态一并处理——缺 route 时 provider 为空串，自然落入未计价分支，不再静默按 flash 估算。

未决：§5 的读数文案（当前用"未计价"角标）、汇率与多币种（暂不涉及）。
