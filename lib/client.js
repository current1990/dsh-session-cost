// dsh-session-cost — Client half (prebuilt web client bundle).
//
// This file is loaded by the web shell's module loader. It is written by hand
// in the same `window.__ModuleLoader__.load` format the official plugin build
// produces, so a third-party package ships a working client bundle without
// the deployment's internal build pipeline.
window.__ModuleLoader__.load({
  id: "dsh-session-cost",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    let react = require("react")

    // ---- Package styles (same injection pattern as generated bundles) ----
    const CSS = [
      '.dsh-session-cost-line { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; line-height: 1.4; opacity: 0.72; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }',
      '.dsh-session-cost-line .dsh-session-cost-live { opacity: 1; color: #f5a623; font-weight: 600; }',
      '.dsh-session-cost-page { display: flex; flex-direction: column; gap: 14px; font-size: 13px; max-width: 640px; }',
      '.dsh-session-cost-title { font-size: 15px; font-weight: 600; }',
      '.dsh-session-cost-note { font-size: 11px; opacity: 0.65; line-height: 1.6; }',
      '.dsh-session-cost-table { border-collapse: collapse; width: 100%; }',
      '.dsh-session-cost-table th, .dsh-session-cost-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(128,128,128,0.25); font-variant-numeric: tabular-nums; }',
      '.dsh-session-cost-table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; }',
      '.dsh-session-cost-table input { width: 96px; padding: 3px 6px; border-radius: 5px; border: 1px solid rgba(128,128,128,0.45); background: transparent; color: inherit; font-variant-numeric: tabular-nums; font-size: 12px; }',
      '.dsh-session-cost-btn { align-self: flex-start; padding: 4px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(128,128,128,0.45); background: rgba(128,128,128,0.12); color: inherit; font-size: 12px; }',
      '.dsh-session-cost-sessions { display: flex; flex-direction: column; gap: 4px; }',
      '.dsh-session-cost-session-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 5px 8px; border: 1px solid rgba(128,128,128,0.25); border-radius: 8px; font-variant-numeric: tabular-nums; }',
      '.dsh-session-cost-session-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; opacity: 0.8; }',
      '.dsh-session-cost-session-meta { font-size: 12px; opacity: 0.75; white-space: nowrap; }',
    ].join('\n')
    const tagId = "dsh-session-cost/styles"
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      const tag = document.createElement("style")
      tag.dataset.plugin = "dsh-session-cost"
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ---- Hand-written Typert Remote contribution ----
    // The official pipeline generates these from TypeScript sources; a
    // third-party package supplies the same shape directly. Codecs are strict
    // (the client registry requires mode:"strict") but use a passthrough
    // schema: the Host gateway still validates the JSON boundary, so the
    // schemas here only satisfy the client registry contract.
    const passthrough = { parse: (value) => value }
    const strictCodec = (typeSymbol) => ({ mode: "strict", typeSymbol, schema: passthrough })
    const jsonParameter = (name) => ({ name, wire: name, source: "json", codec: strictCodec("json") })

    const TYPERT_REMOTE = {
      package: "dsh-session-cost",
      descriptors: [
        {
          id: "dsh-session-cost#sessionCost/state",
          service: "sessionCost",
          namespace: "sessionCost",
          method: "state",
          invocation: { kind: "direct" },
          parameters: [jsonParameter("sessionId")],
          result: strictCodec("json"),
        },
        {
          id: "dsh-session-cost#sessionCost/sessions",
          service: "sessionCost",
          namespace: "sessionCost",
          method: "sessions",
          invocation: { kind: "direct" },
          parameters: [],
          result: strictCodec("json"),
        },
        {
          id: "dsh-session-cost#sessionCost/pricesSet",
          service: "sessionCost",
          namespace: "sessionCost",
          method: "pricesSet",
          invocation: { kind: "direct" },
          parameters: [jsonParameter("model"), jsonParameter("inHit"), jsonParameter("inMiss"), jsonParameter("out")],
          result: strictCodec("json"),
        },
        {
          id: "dsh-session-cost#sessionCost/pricesReset",
          service: "sessionCost",
          namespace: "sessionCost",
          method: "pricesReset",
          invocation: { kind: "direct" },
          parameters: [],
          result: strictCodec("json"),
        },
      ],
    }

    // ---- Formatting helpers ----
    function fmtCny(value) {
      if (!(value > 0)) return '¥0.00'
      if (value < 0.01) return '¥' + value.toFixed(4)
      if (value < 1) return '¥' + value.toFixed(3)
      return '¥' + value.toFixed(2)
    }
    function fmtTokens(value) {
      if (value < 1000) return String(Math.round(value))
      if (value < 1e6) return (value / 1e3).toFixed(1) + 'K'
      return (value / 1e6).toFixed(2) + 'M'
    }

    // ---- Composer dock readout (per-session live line) ----
    function CostDockReadout(props) {
      const sessionId = typeof props.sessionId === "string" ? props.sessionId : ""
      const remoteCall = props.remoteCall
      const interval = props.interval
      const [state, setState] = react.useState(null)
      react.useEffect(() => {
        let alive = true
        const refresh = () => {
          remoteCall("state", [sessionId]).then((data) => {
            if (alive && data !== null) setState(data)
          }).catch(() => {})
        }
        refresh()
        const stop = interval(refresh, 2000)
        return () => { alive = false; stop() }
      }, [sessionId, remoteCall, interval])
      if (state === null) return null
      const durable = state.durable
      const inflight = state.inflight
      if (durable === null && inflight === null) return null
      const total = (durable !== null ? durable.costCny : 0) + (inflight !== null ? inflight.costCny : 0)
      const inTokens = (durable !== null ? durable.inputTokens + durable.cacheReadTokens + durable.cacheWriteTokens : 0)
        + (inflight !== null ? inflight.usage.inputTokens + inflight.usage.cacheReadTokens + inflight.usage.cacheWriteTokens : 0)
      const outTokens = (durable !== null ? durable.outputTokens : 0)
        + (inflight !== null ? inflight.usage.outputTokens : 0)
      return react.createElement('div', {
        className: 'dsh-session-cost-line',
        title: '本会话模型调用费用估算（token 用量 × 单价，人民币）',
      },
        react.createElement('span', null, fmtCny(total)),
        react.createElement('span', null, '·'),
        react.createElement('span', null, fmtTokens(inTokens) + ' in / ' + fmtTokens(outTokens) + ' out'),
        inflight !== null ? react.createElement('span', { className: 'dsh-session-cost-live' }, '· streaming') : null,
      )
    }

    // ---- Settings page (price table editor + all-session overview) ----
    function CostSettingsPage(props) {
      const remoteCall = props.remoteCall
      const interval = props.interval
      const [prices, setPrices] = react.useState(null)
      const [sessions, setSessions] = react.useState(null)
      react.useEffect(() => {
        let alive = true
        const loadPrices = () => {
          remoteCall("state", [null]).then((data) => {
            if (alive && data !== null) setPrices((prev) => prev === null ? data.prices : prev)
          }).catch(() => {})
        }
        const loadSessions = () => {
          remoteCall("sessions", []).then((data) => {
            if (alive && data !== null) setSessions(data.sessions)
          }).catch(() => {})
        }
        loadPrices()
        loadSessions()
        const stop = interval(loadSessions, 5000)
        return () => { alive = false; stop() }
      }, [remoteCall, interval])

      const updatePrice = (model, field, raw) => {
        const value = parseFloat(raw)
        if (value !== value || value < 0 || value > 10000) return
        setPrices((prev) => {
          if (prev === null || prev[model] === undefined) return prev
          const next = {}
          for (const key of Object.keys(prev)) next[key] = { inHit: prev[key].inHit, inMiss: prev[key].inMiss, out: prev[key].out }
          next[model][field] = value
          return next
        })
        if (prices !== null && prices[model] !== undefined) {
          const current = prices[model]
          const inHit = field === 'inHit' ? value : current.inHit
          const inMiss = field === 'inMiss' ? value : current.inMiss
          const out = field === 'out' ? value : current.out
          remoteCall("pricesSet", [model, inHit, inMiss, out]).catch(() => {})
        }
      }

      const resetPrices = () => {
        remoteCall("pricesReset", []).then(() => {
          return remoteCall("state", [null])
        }).then((data) => {
          if (data !== null) setPrices(data.prices)
        }).catch(() => {})
      }

      if (prices === null) {
        return react.createElement('div', { className: 'dsh-session-cost-page' }, '加载中…')
      }
      const modelNames = Object.keys(prices)
      const sessionRows = sessions === null ? [] : sessions
      return react.createElement('div', { className: 'dsh-session-cost-page' },
        react.createElement('div', { className: 'dsh-session-cost-title' }, '会话费用计算器'),
        react.createElement('div', { className: 'dsh-session-cost-note' },
          '费用 = 输入×未命中价 + 缓存读×命中价 + 缓存写×未命中价 + 输出×输出价。单价为人民币（元/百万 tokens），修改后即时生效（含流式中的调用），重启 DSH 后恢复默认。本工具为估算用途，非官方计费凭证。',
        ),
        react.createElement('table', { className: 'dsh-session-cost-table' },
          react.createElement('thead', null, react.createElement('tr', null,
            react.createElement('th', null, '模型'),
            react.createElement('th', null, '输入(缓存命中)'),
            react.createElement('th', null, '输入(缓存未命中)'),
            react.createElement('th', null, '输出'),
          )),
          react.createElement('tbody', null,
            modelNames.map((model) => {
              const p = prices[model]
              return react.createElement('tr', { key: model },
                react.createElement('td', null, model === '*' ? '其他模型' : model),
                react.createElement('td', null, react.createElement('input', {
                  type: 'number', min: '0', step: '0.001', value: p.inHit,
                  onChange: (event) => updatePrice(model, 'inHit', event.target.value),
                })),
                react.createElement('td', null, react.createElement('input', {
                  type: 'number', min: '0', step: '0.001', value: p.inMiss,
                  onChange: (event) => updatePrice(model, 'inMiss', event.target.value),
                })),
                react.createElement('td', null, react.createElement('input', {
                  type: 'number', min: '0', step: '0.001', value: p.out,
                  onChange: (event) => updatePrice(model, 'out', event.target.value),
                })),
              )
            }),
          ),
        ),
        react.createElement('button', { className: 'dsh-session-cost-btn', onClick: resetPrices }, '重置价格'),
        react.createElement('div', { className: 'dsh-session-cost-title' }, '本次启动后观测到的会话'),
        react.createElement('div', { className: 'dsh-session-cost-sessions' },
          sessionRows.length === 0
            ? react.createElement('div', { className: 'dsh-session-cost-note' }, '暂无数据（插件从启动时刻开始记录，新会话会自动出现）')
            : sessionRows.map((row) => react.createElement('div', { key: row.sessionId, className: 'dsh-session-cost-session-row' },
                react.createElement('span', { className: 'dsh-session-cost-session-id' }, row.sessionId),
                react.createElement('span', { className: 'dsh-session-cost-session-meta' },
                  fmtCny(row.costCny) + ' · ' + fmtTokens(row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens) + ' in / ' + fmtTokens(row.outputTokens) + ' out · ' + row.calls + ' 次调用'),
              )),
        ),
      )
    }

    // ---- Cordis client plugin ----
    const inject = ["remote", "slots", "timer"]

    async function apply(ctx) {
      const unmount = await ctx.remote.$mount(TYPERT_REMOTE)

      const namespace = () => ctx.get("remote.sessionCost")
      const remoteCall = async (method, args) => {
        const ns = namespace()
        if (ns === undefined) return null
        const result = await ns[method].apply(ns, args)
        if (result === null || typeof result !== "object" || result.ok !== true) return null
        return result.value
      }
      const interval = (callback, delay) => ctx.interval(callback, delay)

      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register(
        { name: "conversation.composer.dock", id: "session-cost", order: 5, label: "会话费用" },
        (props) => react.createElement(CostDockReadout, { sessionId: props.sessionId, remoteCall, interval }),
      ))
      ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "session-cost", order: 25, label: "会话费用" },
        () => react.createElement(CostSettingsPage, { remoteCall, interval }),
      ))

      return async () => {
        await unmount()
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
