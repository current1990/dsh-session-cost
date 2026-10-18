/**
 * dsh-session-cost — Host side.
 *
 * Registers one session-projection unit (`sessionCost`) that folds every
 * committed `assistant/message` usage report into a per-session cost total
 * under DeepSeek's peak / off-peak CNY pricing. The framework drives the
 * fold, persists checkpoints, and pushes the finished wire view to the
 * Client, so this plugin computes and the framework delivers.
 *
 * Pricing (deepseek-flash / deepseek-v4-pro, 2026-10-17):
 *   prices are 元 per 1M tokens; off-peak is half of peak.
 *   Peak hours are Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00;
 *   weekends are off-peak. Chinese legal holidays cannot be derived from
 *   the session log, so they are billed as their weekday slot.
 */
export const name = 'session-cost'

/** The projection registry is the whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** CNY per 1M tokens: [cache-hit input, cache-miss input, output], peak first. */
const PRICES = {
  'deepseek-flash': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-flash': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-v4-pro': { peak: { hit: 0.3, miss: 9, out: 27 }, off: { hit: 0.15, miss: 4.5, out: 13.5 } },
  'deepseek-chat': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
  'deepseek-reasoner': { peak: { hit: 0.04, miss: 2, out: 8 }, off: { hit: 0.02, miss: 1, out: 4 } },
}

/** Unknown model routes are estimated at Flash prices rather than dropped. */
const FALLBACK = PRICES['deepseek-flash']

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
  calls: 0,
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

/** Price one usage report; cache writes bill at the miss rate. */
function priceUsage(model, usage, peak) {
  const rates = (PRICES[model] ?? FALLBACK)[peak ? 'peak' : 'off']
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
    stateVersion: 1,

    init() {
      return { ...ZERO }
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
      const priced = priceUsage(state.model, usage, isPeak(event.time))
      return {
        model: state.model,
        input: state.input + priced.input,
        cacheRead: state.cacheRead + priced.cacheRead,
        cacheWrite: state.cacheWrite + priced.cacheWrite,
        output: state.output + priced.output,
        reasoning: state.reasoning + count(usage.reasoningTokens),
        costCny: state.costCny + priced.costCny,
        calls: state.calls + 1,
      }
    },

    wire: {
      viewSchema: ANY_JSON,
      view(state) {
        return {
          model: state.model,
          costCny: state.costCny,
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
