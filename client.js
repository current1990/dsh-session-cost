// dsh-session-cost — Client side.
//
// A dock readout below the composer. The value comes from the Host
// `sessionCost` projection (`wire.view`), pushed to the browser by the
// framework; this module only renders it. The line shows the whole session
// family (this session plus its subagent sessions); clicking it opens a small
// panel with the per-session tree, whose subagent group is collapsed until
// the user expands it.
window.__ModuleLoader__.load({
  id: 'dsh-session-cost',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'session-cost'

    /** At most this many subagent rows are listed before the "…" summary. */
    const MAX_VISIBLE_CHILDREN = 10

    /** Visible text goes through the Client locale service. */
    const DICT = {
      en: {
        title: 'Session cost',
        input: 'in',
        output: 'out',
        calls: 'calls',
        peak: 'Peak',
        offPeak: 'Off-peak',
        self: 'This session',
        subagent: 'Subagent',
        subagents: 'Subagents',
        more: 'more',
        offline: 'not loaded',
        ended: 'ended',
        unpriced: 'unpriced',
        breakdown: 'Breakdown',
        expand: 'Show the cost breakdown',
        collapse: 'Hide the cost breakdown',
        expandChildren: 'Show the subagent breakdown',
        collapseChildren: 'Hide the subagent breakdown',
      },
      zh: {
        title: '会话费用',
        input: '输入',
        output: '输出',
        calls: '次调用',
        peak: '高峰',
        offPeak: '空闲',
        self: '本会话',
        subagent: '子代理',
        subagents: '子代理',
        more: '还有',
        offline: '未加载',
        ended: '已结束',
        unpriced: '未计价',
        breakdown: '费用明细',
        expand: '展开费用明细',
        collapse: '收起费用明细',
        expandChildren: '展开子代理明细',
        collapseChildren: '收起子代理明细',
      },
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

    // Typography copies the shipped dock readout (ContextMeter.trigger) beside us.
    const ROOT = { position: 'relative', display: 'inline-flex' }
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
      background: 'transparent',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm)',
      cursor: 'pointer',
    }
    const LINE_OPEN = { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)' }
    const VALUE = { color: 'var(--dsw-alias-label-secondary)' }
    const CARET = { fontSize: '10px', opacity: 0.7 }
    const PANEL = {
      position: 'absolute',
      left: 0,
      bottom: 'calc(100% + 6px)',
      zIndex: 1200,
      minWidth: '260px',
      maxWidth: '420px',
      padding: '10px 12px',
      borderRadius: 'var(--dsw-radius-lg)',
      border: '0.5px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-specific-menu)',
      boxShadow: 'var(--dsw-elevation-prominent)',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      lineHeight: '20px',
      cursor: 'default',
      fontVariantNumeric: 'tabular-nums',
    }
    const PANEL_TITLE = { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', marginBottom: '4px' }
    const ROW = { display: 'flex', alignItems: 'baseline', gap: '8px', whiteSpace: 'nowrap' }
    const ROW_LABEL = { flex: 'auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
    const ROW_META = { flex: 'none', color: 'var(--dsw-alias-label-tertiary)' }
    const DIVIDER = { height: '1px', margin: '6px 0', background: 'var(--dsw-alias-border-l1)' }
    const NOTE = { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', marginTop: '4px' }
    const GROUP = {
      display: 'flex',
      alignItems: 'baseline',
      gap: '6px',
      width: '100%',
      padding: '1px 0',
      margin: '0',
      background: 'transparent',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm)',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
    }
    const MORE_ROW = { color: 'var(--dsw-alias-label-tertiary)', paddingLeft: '12px' }

    /** One rendered row; `depth` drives the indentation. */
    function rowElement(key, depth, label, node, t, statusMark) {
      const meta = fmtCny(node.costCny) + ' · ' + node.calls + ' ' + t('calls')
        + ' · ' + fmtTokens(node.tokensIn) + ' ' + t('input') + ' / ' + fmtTokens(node.tokensOut) + ' ' + t('output')
        + (node.unpricedCalls > 0 ? ' · ' + node.unpricedCalls + ' ' + t('unpriced') : '')
        + (statusMark === '' ? '' : ' · ' + statusMark)
      return h('div', { key, style: { ...ROW, paddingLeft: depth * 12 + 'px' } },
        h('span', { style: ROW_LABEL, title: node.childId ?? '' }, label),
        h('span', { style: ROW_META }, meta),
      )
    }

    /** Flatten the child tree into plain descriptors (no elements, so it can be capped). */
    function flattenChildren(children, depth, out, t) {
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        const label = child.label !== '' ? child.label : (t('subagent') + ' ' + String(index + 1))
        const mark = child.known === true ? (child.live ? '' : t('ended')) : t('offline')
        out.push({ key: 'c:' + child.childId + ':' + depth, depth, label, node: child, mark })
        flattenChildren(Array.isArray(child.children) ? child.children : [], depth + 1, out, t)
      }
      return out
    }

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
          const [open, setOpen] = React.useState(false)
          const [childrenOpen, setChildrenOpen] = React.useState(false)
          const rootRef = React.useRef(null)

          React.useEffect(() => {
            if (!open) return undefined
            const onPointerDown = (event) => {
              if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
            }
            const onKeyDown = (event) => {
              if (event.key === 'Escape') setOpen(false)
            }
            document.addEventListener('mousedown', onPointerDown)
            document.addEventListener('keydown', onKeyDown)
            return () => {
              document.removeEventListener('mousedown', onPointerDown)
              document.removeEventListener('keydown', onKeyDown)
            }
          }, [open])

          if (value === undefined || value === null) return null
          const family = value.family !== null && typeof value.family === 'object'
            ? value.family
            : { costCny: value.costCny, calls: value.calls, tokensIn: value.inputTokens + value.cacheReadTokens + value.cacheWriteTokens, tokensOut: value.outputTokens, unpricedCalls: value.unpricedCalls, unknownChildren: 0 }
          if (family.calls === 0 && family.costCny === 0) return null

          const children = Array.isArray(value.familyChildren) ? value.familyChildren : []
          const descriptors = flattenChildren(children, 1, [], t)
          const visible = descriptors.slice(0, MAX_VISIBLE_CHILDREN)
          const hidden = descriptors.length - visible.length
          const childrenCost = Number(family.costCny) - Number(value.costCny)
          const unpriced = Number(family.unpricedCalls) || 0
          const unknown = Number(family.unknownChildren) || 0
          const text = fmtCny(family.costCny)
            + ' · ' + family.calls + ' ' + t('calls')
            + (children.length > 0 ? ' · ' + t('subagent') + ' ' + children.length : '')
            + (unpriced > 0 ? ' · ' + unpriced + ' ' + t('unpriced') : '')

          const childrenSection = descriptors.length === 0
            ? null
            : [
              h('button', {
                key: 'group',
                type: 'button',
                style: GROUP,
                'aria-expanded': childrenOpen,
                title: childrenOpen ? t('collapseChildren') : t('expandChildren'),
                onClick: () => setChildrenOpen(!childrenOpen),
              },
                h('span', { style: CARET, 'aria-hidden': true }, childrenOpen ? '▾' : '▸'),
                h('span', { style: ROW_LABEL }, t('subagents') + ' ' + descriptors.length),
                h('span', { style: ROW_META }, fmtCny(childrenCost > 0 ? childrenCost : 0)),
              ),
              childrenOpen
                ? h('div', { key: 'rows' },
                  visible.map((item) => rowElement(item.key, item.depth, item.label, item.node, t, item.mark)),
                  hidden > 0
                    ? h('div', { key: 'more', style: MORE_ROW }, '… ' + t('more') + ' ' + hidden)
                    : null,
                )
                : null,
            ]

          return h('div', { ref: rootRef, style: ROOT },
            h('button', {
              type: 'button',
              style: open ? { ...LINE, ...LINE_OPEN } : LINE,
              title: breakdown(value) + '\n' + (open ? t('collapse') : t('expand')),
              'aria-expanded': open,
              'aria-haspopup': 'dialog',
              onClick: () => setOpen(!open),
            },
              h('span', null, t('title')),
              h('span', { style: VALUE }, text),
              h('span', { style: CARET, 'aria-hidden': true }, open ? '▾' : '▸'),
            ),
            open ? h('div', { style: PANEL, role: 'dialog' },
              h('div', { style: PANEL_TITLE }, t('breakdown')),
              rowElement('self', 0, t('self'), {
                costCny: value.costCny,
                calls: value.calls,
                tokensIn: value.inputTokens + value.cacheReadTokens + value.cacheWriteTokens,
                tokensOut: value.outputTokens,
                unpricedCalls: value.unpricedCalls,
                childId: undefined,
              }, t, ''),
              childrenSection,
              h('div', { style: NOTE },
                t('peak') + ' ' + fmtCny(value.costPeak) + ' · ' + t('offPeak') + ' ' + fmtCny(value.costOffPeak)
                + (unknown > 0 ? ' · ' + unknown + ' ' + t('offline') : '')),
            ) : null,
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
