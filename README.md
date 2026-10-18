# dsh-session-cost

DeepSeek Harness (DSH) 的实时会话费用估算插件（人民币计价），适配 **DSH Desktop 0.2.x**。

- **实时读数**：输入框下方显示当前会话累计费用，例如 `会话费用 ¥0.52 · 1.2M 输入 / 30.1K 输出 · 18 次调用`；
- **日志权威**：费用由会话日志的 `assistant/message` 用量事件逐条累加（缓存命中/未命中拆分），重试与回放不会重复计数；
- **按调用时间计价**：价格表带生效日期（`PRICES` 下方的 `ERAS`），每条调用按发生时点取当时单价，**调价不会改写历史调用的金额**；
- **峰谷与调价前后拆分**：悬停读数可看到高峰/空闲费用，以及各价格区间（如 `2026-10-17`、`pre-2026-10-17`）分别花了多少；
- **零客户端计算**：宿主侧 `sessionCost` projection 折叠出结果并推送到页面，客户端只负责渲染。

> 估算工具：单价来自 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，
> 不含法定节假日判断（按工作日时段计），**不是官方计费凭证**。

## 安装（DSH Desktop）

在 Desktop 里：**设置 → 插件 → 添加**，选择本目录（本机文件夹）或填入包名安装。
Harness 的插件管理器会把它装进当前 profile（`desktop`），并自动插入
`cordis.patch.yml` 中的插件行：

```yaml
- insert:
    - id: session-cost
      name: dsh-session-cost
```

安装后无需重启即可生效（宿主行经 HMR 激活，页面刷新后出现读数）。

## 价格历史（元/百万 tokens）

每条调用按发生时刻（日志事件的 `time`）选取当时生效的价格，因此**调价只影响之后的调用**。

**2026-10-17 起**（峰谷分时：空闲价为高峰价一半；高峰 = 北京时间周一至周五 9:00–12:00、14:00–18:00）

| 模型 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- |
| deepseek-flash（空闲/高峰） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| deepseek-v4-pro（空闲/高峰） | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

**2026-10-17 之前**（当时为单一价，无峰谷）

| 模型 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- |
| deepseek-v4-flash | 0.02 | 1 | 2 |
| deepseek-v4-pro | 0.025 | 3 | 6 |
| deepseek-chat | 0.5 | 2 | 8 |
| deepseek-reasoner | 1 | 4 | 16 |

未列出的模型按 deepseek-flash 计（保守估算）。
计费公式：`费用 = 未缓存输入×未命中价 + 缓存读×命中价 + 缓存写×未命中价 + 输出×输出价`。
新增调价时在 `index.js` 的 `ERAS` 里插入一条（含 `since` 生效日期与 `models` 单价）即可，历史金额不受影响。

## 结构

```
index.js          宿主侧：sessionCost projection（折叠用量 → 费用，wire.view 推给客户端）
client.js         客户端侧：composer 下方读数（useProjection 读取，locale 文案）
cordis.patch.yml  插入宿主插件行
locale/*.json     插件卡片的标题/描述（en、zh）
icon.svg          插件图标
```

- 宿主侧通过 `ctx.sessionProjections.register()` 注册投影单元，状态是纯 JSON，随投影缓存持久化；
- 客户端通过标准 props 的 `useProjection('sessionCost')` 读取框架推送的整值，不做任何事件折叠；
- 文本走 `ctx.locale`，样式只用 `--dsw-alias-*` 主题 token。

## 兼容性

- 针对 DSH Desktop `0.2.1-rc.x` 编写（投影 `wire.view`、`useProjection`、slot 注册契约）。
- 不依赖任何 npm 包：bundle 自带宿主与客户端代码，安装时无需构建。

## 已知限制

- **子代理不计入本会话**：子代理是独立会话（`origin: "subagent"`），有自己的日志与费用；父会话读数不聚合它们。打开子会话可看到它自己的费用。
- **按 model 计价、未区分渠道**：同一 model 在不同 provider 的价格差异目前无法表达；未命中价格表的模型按 flash 价静默估算。
- **会话内切换模型**是按调用时点计价的（不会串价），但上述两种边界情况仍在。

以上问题的分析与候选方案见 [docs/RFC-0001-billing-edge-cases.md](./docs/RFC-0001-billing-edge-cases.md)。

## License

MIT
