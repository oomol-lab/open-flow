import type { FlowCanvasViewNode } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FlowNodeList } from './flowNodeList.tsx'

const nodes: readonly FlowCanvasViewNode[] = [
  {
    id: 'trigger',
    kind: 'trigger',
    title: 'Manual trigger',
    inputs: [],
    outputs: [],
    position: { x: 0, y: 0 },
  },
  {
    id: 'task',
    kind: 'task',
    title: 'Review issues',
    inputs: [],
    outputs: [],
    position: { x: 0, y: 100 },
    reference: 'review',
  },
]

function render(groupTriggers = false): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <FlowNodeList groupTriggers={groupTriggers} nodes={nodes} onFocusNode={() => undefined} onSelect={() => undefined} />
    </I18nProvider>,
  )
}

describe('FlowNodeList', () => {
  it('groups triggers in the full outline', () => {
    const markup = render(true)
    expect(markup).toContain('Triggers')
    expect(markup).toContain('Nodes')
    expect(markup).toContain('Manual trigger')
    expect(markup).toContain('Review issues')
    expect(markup.indexOf('Manual trigger')).toBeLessThan(markup.indexOf('Review issues'))
  })

  it('lists selected nodes without group headings', () => {
    const markup = render()
    expect(markup).not.toContain('Triggers')
    expect(markup).not.toContain('Nodes')
    expect(markup).toContain('Manual trigger')
    expect(markup).toContain('Review issues')
    expect(markup.match(/aria-label="Locate this node on the canvas"/g)).toHaveLength(2)
  })
})
