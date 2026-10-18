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
      en: { title: 'Session cost', input: 'in', output: 'out', calls: 'calls', peak: 'peak hours' },
      zh: { title: '会话费用', input: '输入', output: '输出', calls: '次调用', peak: '高峰时段' },
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

    const LINE = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11px',
      lineHeight: '1.4',
      color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }
    const VALUE = { color: 'var(--dsw-alias-label-primary)' }
    const SEP = { opacity: 0.6 }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'session-cost: locale dictionaries')
        const t = ctx.locale.bind(NS)

        function CostReadout(props) {
          const value = props.useProjection('sessionCost')
          if (value === undefined || value === null || value.calls === 0) return null
          const inputTokens = value.inputTokens + value.cacheReadTokens + value.cacheWriteTokens
          const details = []
          details.push(fmtCny(value.costCny))
          details.push(' · ')
          details.push(fmtTokens(inputTokens) + ' ' + t('input') + ' / ' + fmtTokens(value.outputTokens) + ' ' + t('output'))
          details.push(' · ')
          details.push(String(value.calls) + ' ' + t('calls'))
          return h('div', {
            style: LINE,
            title: t('title') + (value.model === '' ? '' : ' · ' + value.model),
          },
            h('span', null, t('title')),
            h('span', { style: VALUE }, details.join('')),
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
