/**
 * dsh-session-cost — Host side.
 *
 * Registers one session-projection unit (`sessionCost`) that folds every
 * committed `assistant/message` usage report into a per-session cost total.
 *
 * Pricing is a DATE-RANGED history: each call is priced by the rates in
 * effect at that call's `event.time`, so a price change never rewrites what
 * earlier calls cost and the fold stays deterministic for one log.
 * The view also splits cost into peak / off-peak and into price eras.
 *
 * Rates are CNY per 1M tokens. Source: DeepSeek pricing docs
 * (api-docs.deepseek.com/zh-cn/quick_start/pricing).
 *   - From 2026-10-17 the models are deepseek-flash / deepseek-v4-pro and the
 *     price is peak / off-peak (off-peak is half of peak). Peak hours are
 *     Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00; weekends are off-peak.
 *     Chinese legal holidays cannot be derived from the session log, so they
 *     are billed as their weekday slot.
 *   - Before that date rates were flat, under the deepseek-v4-* names.
 */
export const name = 'session-cost'

/** The projection registry is the whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** First Beijing-midnight boundary of a rate change; adjust if news differs. */
const PRICE_CHANGE_AT = Date.parse('2026-10-17T00:00:00+08:00')

/** Rate table: `peak` and `off` are [cache-hit, cache-miss, output] CNY / 1M tokens. */
const CURRENT_MODELS = {
  'deepseek-flash': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-flash': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-pro': { peak: { hit: 0.3, miss: 9, out: 27 }, off: { hit: 0.15, miss: 4.5, out: 13.5 } },
  'deepseek-chat': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-reasoner': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
}
const PREVIOUS_MODELS = {
  'deepseek-v4-flash': { peak: { hit: 0.02, miss: 1, out: 2 }, off: { hit: 0.02, miss: 1, out: 2 } },
  'deepseek-v4-pro': { peak: { hit: 0.025, miss: 3, out: 6 }, off: { hit: 0.025, miss: 3, out: 6 } },
  'deepseek-chat': { peak: { hit: 0.5, miss: 2, out: 8 }, off: { hit: 0.5, miss: 2, out: 8 } },
  'deepseek-reasoner': { peak: { hit: 1, miss: 4, out: 16 }, off: { hit: 1, miss: 4, out: 16 } },
}

/** Newest era first; `since` is the Beijing-midnight boundary of the era. */
const ERAS = [
  { id: '2026-10-17', since: PRICE_CHANGE_AT, peak: true, models: CURRENT_MODELS },
  { id: 'pre-2026-10-17', since: 0, peak: false, models: PREVIOUS_MODELS },
]
const FALLBACK_RATES = { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } }

/** The registry only calls `.parse()`; a passthrough keeps this bundle dependency-free. */
const ANY_JSON = { parse: (value) => value }

const ZERO = {
  model: '',
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  costCny: 0,
  costPeak: 0,
  costOffPeak: 0,
  calls: 0,
  costByEra: {},
}

function count(value) {
  return typeof value === 'number' && value >= 0 ? value : 0
}

/** Beijing is UTC+8 with no DST, so shifting the epoch and reading UTC fields is exact. */
function isPeak(timeMs) {
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return false
  const beijing = new Date(timeMs + 8 * 60 * 60 * 1000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = beijing.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** Resolve the era in effect at one call time (ERAS is newest-first). */
function eraFor(timeMs) {
  for (const era of ERAS) {
    if (typeof timeMs === 'number' && timeMs >= era.since) return era
  }
  return ERAS[ERAS.length - 1]
}

/** Price one usage report under its era; flat eras carry identical peak/off rates. */
function priceUsage(model, usage, era, peak) {
  const rates = (era.models[model] ?? FALLBACK_RATES)[peak && era.peak ? 'peak' : 'off']
  const input = count(usage.inputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  const output = count(usage.outputTokens)
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    costCny: (input * rates.miss + cacheRead * rates.hit + cacheWrite * rates.miss + output * rates.out) / 1e6,
  }
}

export function apply(ctx) {
  ctx.sessionProjections.register({
    key: 'sessionCost',
    stateSchema: ANY_JSON,
    stateVersion: 2,

    init() {
      return { ...ZERO, costByEra: {} }
    },

    apply(state, event) {
      if (event.type === 'request/context') {
        const model = event.data.model
        if (typeof model !== 'string' || model === state.model) return state
        return { ...state, model }
      }
      if (event.type !== 'assistant/message') return state
      const usage = event.data.usage
      if (usage === undefined || usage === null) return state
      const era = eraFor(event.time)
      const peak = isPeak(event.time)
      const priced = priceUsage(state.model, usage, era, peak)
      const costByEra = { ...state.costByEra }
      costByEra[era.id] = count(costByEra[era.id]) + priced.costCny
      return {
        model: state.model,
        input: state.input + priced.input,
        cacheRead: state.cacheRead + priced.cacheRead,
        cacheWrite: state.cacheWrite + priced.cacheWrite,
        output: state.output + priced.output,
        reasoning: state.reasoning + count(usage.reasoningTokens),
        costCny: state.costCny + priced.costCny,
        costPeak: state.costPeak + (peak && era.peak ? priced.costCny : 0),
        costOffPeak: state.costOffPeak + (peak && era.peak ? 0 : priced.costCny),
        calls: state.calls + 1,
        costByEra,
      }
    },

    wire: {
      viewSchema: ANY_JSON,
      view(state) {
        const costByEra = {}
        for (const id of Object.keys(state.costByEra)) costByEra[id] = state.costByEra[id]
        return {
          model: state.model,
          costCny: state.costCny,
          costPeak: state.costPeak,
          costOffPeak: state.costOffPeak,
          costByEra,
          inputTokens: state.input,
          cacheReadTokens: state.cacheRead,
          cacheWriteTokens: state.cacheWrite,
          outputTokens: state.output,
          reasoningTokens: state.reasoning,
          calls: state.calls,
        }
      },
    },
  })
}
