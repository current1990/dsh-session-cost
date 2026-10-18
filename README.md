# dsh-session-cost

DeepSeek Harness (DSH) 的实时会话费用估算插件（人民币计价），适配 **DSH Desktop 0.2.x**。

- **实时读数**：输入框下方显示当前会话累计费用，例如 `会话费用 ¥0.52 · 1.2M 输入 / 30.1K 输出 · 18 次调用`；
- **日志权威**：费用由会话日志的 `assistant/message` 用量事件逐条累加（缓存命中/未命中拆分），重试与回放不会重复计数；
- **峰谷分时**：按事件时间自动区分 DeepSeek 高峰/空闲时段（北京时间工作日 9:00–12:00、14:00–18:00 为高峰，价格翻倍；周末按空闲计）；
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

## 内置单价（元/百万 tokens，2026-10-17 官方价）

| 模型 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- |
| deepseek-flash（空闲/高峰） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| deepseek-v4-pro（空闲/高峰） | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |
| 其他模型（兜底） | 按 flash 计价 | | |

计费公式：`费用 = 未缓存输入×未命中价 + 缓存读×命中价 + 缓存写×未命中价 + 输出×输出价`。
价格调整后修改 `index.js` 的 `PRICES` 表并重新安装即可。

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

## License

MIT
