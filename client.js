// dsh-session-cost — Client side.
//
// A dock readout below the composer. The value comes from the Host
// `sessionCost` projection (`wire.view`), pushed to the browser by the
// framework; this module only renders it.
window.__ModuleLoader__.load({
  id: 'dsh-session-cost',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'session-cost'

    /** Visible text goes through the Client locale service. */
    const DICT = {
      en: { title: 'Session cost', input: 'in', output: 'out', calls: 'calls', peak: 'Peak', offPeak: 'Off-peak' },
      zh: { title: '会话费用', input: '输入', output: '输出', calls: '次调用', peak: '高峰', offPeak: '空闲' },
    }

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

    // Matches the shipped dock readout (ContextMeter.trigger) that renders in the
    // same row: same size token, line box, tertiary label color, padding and gap.
    const LINE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      flex: 'none',
      fontFamily: 'inherit',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      color: 'var(--dsw-alias-label-tertiary)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      padding: '1px 8px',
    }
    const VALUE = { color: 'var(--dsw-alias-label-secondary)' }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'session-cost: locale dictionaries')
        const t = ctx.locale.bind(NS)

        /** Multiline tooltip: peak/off-peak split and per-price-era totals. */
        function breakdown(value) {
          const lines = [t('title') + (value.model === '' ? '' : ' · ' + value.model)]
          const peak = Number(value.costPeak) || 0
          const offPeak = Number(value.costOffPeak) || 0
          lines.push(t('peak') + ' ' + fmtCny(peak) + ' · ' + t('offPeak') + ' ' + fmtCny(offPeak))
          const byEra = value.costByEra !== null && typeof value.costByEra === 'object' ? value.costByEra : {}
          const eras = Object.keys(byEra)
          if (eras.length > 1) {
            lines.push(eras.map((id) => id + ' ' + fmtCny(Number(byEra[id]) || 0)).join(' · '))
          }
          return lines.join('\n')
        }

        function CostReadout(props) {
          const value = props.useProjection('sessionCost')
          if (value === undefined || value === null || value.calls === 0) return null
          const inputTokens = value.inputTokens + value.cacheReadTokens + value.cacheWriteTokens
          const text = fmtCny(value.costCny)
            + ' · ' + fmtTokens(inputTokens) + ' ' + t('input')
            + ' / ' + fmtTokens(value.outputTokens) + ' ' + t('output')
            + ' · ' + value.calls + ' ' + t('calls')
          return h('div', { style: LINE, title: breakdown(value) },
            h('span', null, t('title')),
            h('span', { style: VALUE }, text),
          )
        }

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'session-cost',
          order: 5,
          label: () => t('title'),
        }, CostReadout))
      },
    }
  },
})
