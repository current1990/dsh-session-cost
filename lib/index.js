/**
 * dsh-session-cost — Host side.
 *
 * A process-wide session cost meter for the DeepSeek Harness:
 *  - a durable per-session ledger folded from `assistant/message` usage events
 *    (seeded from the whole log on first sight, then updated incrementally);
 *  - a live in-flight observation from a transparent `llm/stream` passthrough;
 *  - a `sessionCost` Remote service consumed by the web client.
 *
 * Prices are CNY (元) per 1M tokens and editable at runtime through the Remote
 * service; the table resets to the built-in defaults on restart.
 *
 * IMPORTANT for the Typert gateway's SRC (source-reflection) fallback: every
 * Remote method below must keep a plain identifier parameter list — no
 * defaults, no destructuring, no rest — and parameter names ARE the wire field
 * names. `signal` as the final parameter would be treated as the cancellation
 * signal.
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** CNY per 1M tokens. DeepSeek official pricing (api-docs.deepseek.com/zh-cn, 2026-08). */
const DEFAULTS = {
  'deepseek-v4-flash': { inHit: 0.02, inMiss: 1, out: 2 },
  'deepseek-v4-pro': { inHit: 0.025, inMiss: 3, out: 6 },
  'deepseek-chat': { inHit: 0.5, inMiss: 2, out: 8 },
  'deepseek-reasoner': { inHit: 1, inMiss: 4, out: 16 },
  '*': { inHit: 0.02, inMiss: 1, out: 2 },
}

function num(value) {
  return typeof value === 'number' && value >= 0 ? value : 0
}

export const name = 'session-cost'

export function apply(ctx) {
  const service = new SessionCostService(ctx)
  attachRemoteMarkers(service)

  ctx.on('session/event', (session, event) => {
    try {
      service.onSessionEvent(session, event)
    } catch (error) {
      console.error('[session-cost] session/event handling failed:', error)
    }
  })

  ctx.on('llm/stream', (options, next) => service.wrapStream(options, next))
}

class SessionCostService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'sessionCost')
    this.prices = {}
    this.ledgers = new Map()
    this.inflight = new Map()
    for (const key of Object.keys(DEFAULTS)) {
      this.prices[key] = { inHit: DEFAULTS[key].inHit, inMiss: DEFAULTS[key].inMiss, out: DEFAULTS[key].out }
    }
  }

  priceOf(model) {
    const direct = typeof model === 'string' ? this.prices[model] : undefined
    return direct !== undefined ? direct : this.prices['*']
  }

  emptyEntry() {
    return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, costCny: 0, calls: 0, models: {} }
  }

  addUsage(sid, model, usage) {
    const entry = this.ledgers.get(sid) === undefined ? this.emptyEntry() : this.ledgers.get(sid)
    const price = this.priceOf(model)
    const input = num(usage.inputTokens)
    const read = num(usage.cacheReadTokens)
    const write = num(usage.cacheWriteTokens)
    const output = num(usage.outputTokens)
    entry.inputTokens += input
    entry.cacheReadTokens += read
    entry.cacheWriteTokens += write
    entry.outputTokens += output
    entry.reasoningTokens += num(usage.reasoningTokens)
    // Billed input = uncached input + cache write at miss price + cache read at hit price.
    entry.costCny += (input * price.inMiss + read * price.inHit + write * price.inMiss + output * price.out) / 1e6
    entry.calls += 1
    const key = typeof model === 'string' && model.length > 0 ? model : 'unknown'
    entry.models[key] = typeof entry.models[key] === 'number' ? entry.models[key] + 1 : 1
    this.ledgers.set(sid, entry)
  }

  foldSession(session) {
    let sid
    let events
    try {
      sid = session.id
      events = session.events
    } catch (error) {
      return
    }
    if (this.ledgers.has(sid)) return
    this.ledgers.set(sid, this.emptyEntry())
    let model
    for (const event of events) {
      if (event.type === 'request/context' && event.data !== null && typeof event.data === 'object' && typeof event.data.model === 'string') {
        model = event.data.model
      }
      if (event.type === 'assistant/message' && event.data !== null && typeof event.data === 'object' && event.data.usage !== undefined && event.data.usage !== null) {
        this.addUsage(sid, model, event.data.usage)
      }
    }
  }

  onSessionEvent(session, event) {
    const sid = session.id
    if (this.ledgers.get(sid) === undefined) {
      // First sight: fold the whole log. The just-appended event is already in it.
      this.foldSession(session)
      return
    }
    if (event.type === 'assistant/message' && event.data !== null && typeof event.data === 'object') {
      if (event.data.usage !== undefined && event.data.usage !== null) {
        let model
        try {
          const context = session.requestContext()
          if (context !== undefined && context !== null && typeof context.model === 'string') model = context.model
        } catch (error) {
          // model stays undefined; priced at the fallback entry
        }
        this.addUsage(sid, model, event.data.usage)
      }
      this.inflight.delete(sid)
    }
  }

  wrapStream(options, next) {
    const service = this
    const sid = options !== null && typeof options === 'object' && typeof options.sessionId === 'string' && options.sessionId.length > 0
      ? options.sessionId
      : 'unknown'
    const model = options !== null && typeof options === 'object' && typeof options.model === 'string' && options.model.length > 0
      ? options.model
      : 'unknown'
    return (async function* () {
      for await (const chunk of next()) {
        try {
          if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== null && typeof chunk.usage === 'object') {
            service.inflight.set(sid, {
              model,
              usage: {
                inputTokens: num(chunk.usage.inputTokens),
                cacheReadTokens: num(chunk.usage.cacheReadTokens),
                cacheWriteTokens: num(chunk.usage.cacheWriteTokens),
                outputTokens: num(chunk.usage.outputTokens),
              },
            })
          }
        } catch (error) {
          console.error('[session-cost] stream observation failed:', error)
        }
        yield chunk
      }
    })()
  }

  durableView(sid) {
    const entry = this.ledgers.get(sid)
    if (entry === undefined) return null
    const models = {}
    for (const key of Object.keys(entry.models)) models[key] = entry.models[key]
    return {
      inputTokens: entry.inputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      outputTokens: entry.outputTokens,
      reasoningTokens: entry.reasoningTokens,
      costCny: entry.costCny,
      calls: entry.calls,
      models,
    }
  }

  inflightView(sid) {
    const entry = this.inflight.get(sid)
    if (entry === undefined) return null
    const price = this.priceOf(entry.model)
    const usage = entry.usage
    return {
      model: entry.model,
      usage: {
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
      },
      costCny: (usage.inputTokens * price.inMiss + usage.cacheReadTokens * price.inHit + usage.cacheWriteTokens * price.inMiss + usage.outputTokens * price.out) / 1e6,
    }
  }

  pricesView() {
    const view = {}
    for (const key of Object.keys(this.prices)) {
      view[key] = { inHit: this.prices[key].inHit, inMiss: this.prices[key].inMiss, out: this.prices[key].out }
    }
    return view
  }

  // ---- Remote methods (SRC-friendly signatures; parameter names are wire fields) ----

  state(sessionId) {
    const sid = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
    return {
      durable: sid === null ? null : this.durableView(sid),
      inflight: sid === null ? null : this.inflightView(sid),
      prices: this.pricesView(),
    }
  }

  sessions() {
    const sessions = []
    for (const [sessionId, entry] of this.ledgers) {
      sessions.push({
        sessionId,
        costCny: entry.costCny,
        inputTokens: entry.inputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        outputTokens: entry.outputTokens,
        calls: entry.calls,
      })
    }
    sessions.sort((left, right) => right.costCny - left.costCny)
    return { sessions }
  }

  pricesSet(model, inHit, inMiss, out) {
    if (typeof model !== 'string' || model.length === 0 || model === '*') return { ok: false }
    const current = this.priceOf(model)
    const next = {
      inHit: typeof inHit === 'number' && inHit >= 0 && inHit < 10000 ? inHit : current.inHit,
      inMiss: typeof inMiss === 'number' && inMiss >= 0 && inMiss < 10000 ? inMiss : current.inMiss,
      out: typeof out === 'number' && out >= 0 && out < 10000 ? out : current.out,
    }
    this.prices[model] = next
    return { ok: true }
  }

  pricesReset() {
    for (const key of Object.keys(this.prices)) delete this.prices[key]
    for (const key of Object.keys(DEFAULTS)) {
      this.prices[key] = { inHit: DEFAULTS[key].inHit, inMiss: DEFAULTS[key].inMiss, out: DEFAULTS[key].out }
    }
    return { ok: true }
  }
}

/**
 * Attach `@Remote` markers without decorator syntax: emulate the standard
 * decorator initializer (`Remote(name)(_, context)`), then run each
 * initializer against the live instance so the private marker table records
 * the class prototype exactly like the compiled decorator output would.
 */
function attachRemoteMarkers(service) {
  const methodNames = ['state', 'sessions', 'pricesSet', 'pricesReset']
  for (const methodName of methodNames) {
    const initializers = []
    Remote(methodName)(undefined, {
      kind: 'method',
      name: methodName,
      static: false,
      private: false,
      addInitializer: (initializer) => {
        initializers.push(initializer)
      },
    })
    for (const initializer of initializers) initializer.call(service)
  }
}
