# dsh-session-cost

DeepSeek Harness (DSH) 的实时会话费用估算插件（人民币计价）。

- **实时读数**：composer 输入框下方显示当前会话累计费用（`¥0.52 · 2.4M in / 39.9K out · streaming`），每 2 秒刷新，流式生成时显示 live 标记；
- **权威账本**：用量取自会话日志的 `assistant/message` 事件（含缓存命中/未命中拆分），首次见到会话时折叠全部历史，重试与回放不重复计数；
- **价格面板**：设置 → **会话费用** 页面可编辑每个模型的单价（元/百万 tokens）并一键重置；修改即时生效；
- **多会话总览**：同一页面列出本次启动以来观测到的所有会话的费用。

> 本插件是**估算工具**：用量来自会话日志与流式观察，价格表取自
> [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
> （官方已预告近期调价），**不是官方计费凭证**。

## 安装

要求：DSH 0.1.0-rc.x（`npm i -g @deepseek-ai/dsh`）。

```bash
# 从 GitHub 安装（也支持 npm 包名、本地路径）
dsh plugin --profile web add github:<你的用户名>/dsh-session-cost

# 在 ~/.dsh/profiles/web/cordis.patch.yml 中挂载宿主插件（若文件内容为 [] 则整体替换）：
# - insert:
#     - id: session-cost
#       name: 'dsh-session-cost'

# 重启 web profile 生效
dsh web
```

安装后可在 **设置 → 插件** 中看到 `dsh-session-cost` 条目。

## 内置价格表（元/百万 tokens，2026-08 官方价）

| 模型 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- |
| deepseek-v4-flash | 0.02 | 1 | 2 |
| deepseek-v4-pro | 0.025 | 3 | 6 |
| deepseek-chat | 0.5 | 2 | 8 |
| deepseek-reasoner | 1 | 4 | 16 |
| 其他模型（`*` 兜底） | 0.02 | 1 | 2 |

计费公式：`费用 = 未缓存输入×未命中价 + 缓存读×命中价 + 缓存写×未命中价 + 输出×输出价`。

## 结构

```
lib/index.js    宿主半：session/event + llm/stream 账本 + sessionCost Remote 服务
lib/client.js   客户端半（预构建 web bundle）：composer 读数 + 设置页
```

- 宿主插件通过 `sessionCost` Remote 服务（`@deepseek-ai/dsh-typert-protocol` 的
  `TypertRemoteService` + `Remote` 标记）与客户端通信；DSH 网关的 SRC 回退使纯 JS
  包无需生成 Typert 文件。
- `lib/client.js` 采用 `window.__ModuleLoader__.load` 格式手写，与官方插件构建产物
  同构；修改后重启 web profile 生效。
- 单价存于内存：插件重启后回到内置默认值（这是有意的设计——动态价格不需要持久化）。

## 兼容性

- 针对 DSH `0.1.0-rc.x` 构建；DSH 仍处于 rc 阶段，插件 API 可能变动。
- peerDependencies：`@deepseek-ai/cordis` ^4、`@deepseek-ai/dsh-typert-protocol` ^0.1.0-rc.6。

## License

MIT
