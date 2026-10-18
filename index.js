/**
 * dsh-session-cost — Host side.
 *
 * Registers one session-projection unit (`sessionCost`) that folds every
 * committed `assistant/message` usage report into a per-session cost total,
 * plus the session family tree for the open session:
 *
 *  - PRICING is a date-ranged history; each call is priced by the rates in
 *    effect at that call's `event.time` (see ERAS below).
 *  - PROVIDERS: only DeepSeek's own routes are priced (`PROVIDERS`). Any other
 *    route's usage is counted as UNPRICED — tokens are accumulated, money is
 *    not invented.
 *  - FAMILY: the parent log durably records direct children as
 *    `subagent/catalog` events, so the tree is folded from this session's own
 *    log. A child's cost is read from that child session's own projection
 *    state while it is live; a child that is no longer live is reported as
 *    unknown (`live: false`) instead of being dropped silently.
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

/** The projection registry is the whole purpose; sessions serve the family tree. */
export const inject = ['sessionProjections', 'sessions']

/** First Beijing-midnight boundary of a rate change; adjust if news differs. */
const PRICE_CHANGE_AT = Date.parse('2026-10-17T00:00:00+08:00')

/** Only DeepSeek's own routes are priced; everything else is reported as unpriced. */
const PROVIDERS = new Set(['deepseek-official', 'deepseek-account'])

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

/** The registry only calls `.parse()`; a passthrough keeps this bundle dependency-free. */
const ANY_JSON = { parse: (value) => value }

const ZERO = {
  provider: '',
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
  unpricedCalls: 0,
  unpricedIn: 0,
  unpricedOut: 0,
  costByEra: {},
  children: [],
}

/** Cap the family walk; nested delegation is shallow in practice. */
const MAX_DEPTH = 8

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

/** Rates for one route, or undefined when this provider/model is not priced. */
function ratesFor(provider, model, era) {
  if (!PROVIDERS.has(provider)) return undefined
  return era.models[model]
}

/** Price one usage report, or classify it as unpriced. */
function priceUsage(provider, model, usage, era, peak) {
  const entry = ratesFor(provider, model, era)
  const input = count(usage.inputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  const output = count(usage.outputTokens)
  if (entry === undefined) {
    return { input, cacheRead, cacheWrite, output, costCny: 0, unpriced: true }
  }
  const rates = entry[peak && era.peak ? 'peak' : 'off']
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    costCny: (input * rates.miss + cacheRead * rates.hit + cacheWrite * rates.miss + output * rates.out) / 1e6,
    unpriced: false,
  }
}

/** Uniform figures for a live projection state or a remembered snapshot. */
function figures(state) {
  return {
    costCny: count(state.costCny),
    calls: count(state.calls),
    unpricedCalls: count(state.unpricedCalls),
    input: count(state.input),
    cacheRead: count(state.cacheRead),
    cacheWrite: count(state.cacheWrite),
    output: count(state.output),
  }
}

/**
 * Client view of this session's direct children and their own subtrees.
 * A child that has left the in-memory store (a finished one-shot subagent) is
 * read from the plugin's own last-known snapshot, so its cost does not vanish
 * the moment it ends; only a child never observed as live stays unknown.
 */
function familyOf(state, ctx, known, depth, seen) {
  const children = []
  if (depth >= MAX_DEPTH || state.children === undefined) return children
  for (const child of state.children) {
    if (seen.has(child.childId)) continue
    seen.add(child.childId)
    const session = ctx.sessions.get(child.childId)
    const liveState = session === undefined ? undefined : ctx.sessionProjections.stateOf(session, 'sessionCost')
    const live = liveState !== undefined
    const remembered = liveState === undefined ? known.get(child.childId) : undefined
    const figuresOf = liveState !== undefined ? figures(liveState) : (remembered === undefined ? undefined : figures(remembered))
    const grandchildren = liveState === undefined ? [] : familyOf(liveState, ctx, known, depth + 1, seen)
    const own = figuresOf ?? { costCny: 0, calls: 0, unpricedCalls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    children.push({
      childId: child.childId,
      label: child.label,
      mode: child.mode,
      live,
      known: figuresOf !== undefined,
      ended: !live && figuresOf !== undefined,
      costCny: own.costCny,
      calls: own.calls,
      unpricedCalls: own.unpricedCalls,
      tokensIn: own.input + own.cacheRead + own.cacheWrite,
      tokensOut: own.output,
      children: grandchildren,
    })
  }
  return children
}

/** Sum one node's own figures with every descendant's. */
function sumFamily(own, children) {
  let costCny = own.costCny
  let calls = own.calls
  let tokensIn = own.input + own.cacheRead + own.cacheWrite
  let tokensOut = own.output
  let unpricedCalls = own.unpricedCalls
  let unknownChildren = 0
  let endedChildren = 0
  const walk = (nodes) => {
    for (const node of nodes) {
      costCny += node.costCny
      calls += node.calls
      tokensIn += node.tokensIn
      tokensOut += node.tokensOut
      unpricedCalls += node.unpricedCalls
      if (!node.known) unknownChildren += 1
      else if (node.ended) endedChildren += 1
      walk(node.children)
    }
  }
  walk(children)
  return { costCny, calls, tokensIn, tokensOut, unpricedCalls, unknownChildren, endedChildren }
}

export function apply(ctx) {
  /**
   * Last-known figures of child sessions, keyed by child session id. Updated
   * from every child session's events, so a child's cost survives the moment
   * the child leaves the in-memory store; seeded at startup from the persisted
   * projection cache, so a restart still counts children that already ended.
   */
  const known = new Map()

  ctx.on('session/event', (session) => {
    try {
      if (session.header === undefined || session.header.parentSession === undefined) return
      const state = ctx.sessionProjections.stateOf(session, 'sessionCost')
      if (state === undefined) return
      known.set(session.id, figures(state))
    } catch (error) {
      console.error('[session-cost] family snapshot failed:', error)
    }
  })

  /**
   * Seed `known` from the persisted projection cache: every stored child
   * session already has our `sessionCost` row (the cache checkpoints on session
   * creation, `turn/end`, and disposal), and `cachedSnapshot` reads it with no
   * log I/O. A child without a usable row stays "not loaded".
   */
  const warm = async (signal) => {
    const persistence = ctx.get('sessionPersistence')
    const cache = ctx.get('sessionProjectionCache')
    if (persistence === undefined || cache === undefined) return
    const snapshots = await persistence.list({ signal })
    for (const snapshot of snapshots) {
      if (signal.aborted) return
      const header = snapshot.header
      if (header === undefined || header.parentSession === undefined) continue
      if (known.has(header.id)) continue
      try {
        const cached = cache.cachedSnapshot(header, ['sessionCost'])
        const value = cached !== undefined && cached.values !== undefined ? cached.values.sessionCost : undefined
        if (value === undefined || value === null) continue
        known.set(header.id, figures({
          costCny: value.costCny,
          calls: value.calls,
          unpricedCalls: value.unpricedCalls,
          input: value.inputTokens,
          cacheRead: value.cacheReadTokens,
          cacheWrite: value.cacheWriteTokens,
          output: value.outputTokens,
        }))
      } catch (error) {
        // A malformed or version-mismatched row simply stays unknown.
      }
    }
  }

  ctx.effect(() => {
    const controller = new AbortController()
    warm(controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.error('[session-cost] family warm-up failed:', error)
    })
    return () => controller.abort()
  }, 'session-cost: warm family snapshots')

  ctx.sessionProjections.register({
    key: 'sessionCost',
    stateSchema: ANY_JSON,
    stateVersion: 3,

    init() {
      return { ...ZERO, costByEra: {}, children: [] }
    },

    apply(state, event) {
      if (event.type === 'request/context') {
        const provider = event.data.provider
        const model = event.data.model
        if (typeof provider !== 'string' || typeof model !== 'string') return state
        if (provider === state.provider && model === state.model) return state
        return { ...state, provider, model }
      }
      if (event.type === 'subagent/catalog') {
        const childId = event.data?.childId
        if (typeof childId !== 'string' || childId.length === 0) return state
        if (state.children.some((child) => child.childId === childId)) return state
        return {
          ...state,
          children: [...state.children, {
            childId,
            label: typeof event.data.label === 'string' ? event.data.label : '',
            mode: typeof event.data.mode === 'string' ? event.data.mode : '',
          }],
        }
      }
      if (event.type !== 'assistant/message') return state
      const usage = event.data.usage
      if (usage === undefined || usage === null) return state
      const era = eraFor(event.time)
      const peak = isPeak(event.time)
      const priced = priceUsage(state.provider, state.model, usage, era, peak)
      const costByEra = { ...state.costByEra }
      if (!priced.unpriced) costByEra[era.id] = count(costByEra[era.id]) + priced.costCny
      return {
        ...state,
        input: state.input + priced.input,
        cacheRead: state.cacheRead + priced.cacheRead,
        cacheWrite: state.cacheWrite + priced.cacheWrite,
        output: state.output + priced.output,
        reasoning: state.reasoning + count(usage.reasoningTokens),
        costCny: state.costCny + priced.costCny,
        costPeak: state.costPeak + (priced.unpriced || !(peak && era.peak) ? 0 : priced.costCny),
        costOffPeak: state.costOffPeak + (priced.unpriced || (peak && era.peak) ? 0 : priced.costCny),
        calls: state.calls + 1,
        unpricedCalls: state.unpricedCalls + (priced.unpriced ? 1 : 0),
        unpricedIn: state.unpricedIn + (priced.unpriced ? priced.input + priced.cacheRead + priced.cacheWrite : 0),
        unpricedOut: state.unpricedOut + (priced.unpriced ? priced.output : 0),
        costByEra,
      }
    },

    wire: {
      viewSchema: ANY_JSON,
      view(state) {
        const children = familyOf(state, ctx, known, 0, new Set())
        const family = sumFamily(state, children)
        const costByEra = {}
        for (const id of Object.keys(state.costByEra)) costByEra[id] = state.costByEra[id]
        return {
          provider: state.provider,
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
          unpricedCalls: state.unpricedCalls,
          unpricedTokensIn: state.unpricedIn,
          unpricedTokensOut: state.unpricedOut,
          family,
          familyChildren: children,
        }
      },
    },
  })
}
