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
    expect(markup).toContain('<h3 class="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Triggers</h3>')
    expect(markup).toContain('<h3 class="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Nodes</h3>')
    expect(markup.match(/flow-node-list-grid/g)).toHaveLength(2)
    expect(markup.indexOf('Manual trigger')).toBeLessThan(markup.indexOf('Review issues'))
  })

  it('keeps a multiple selection in one responsive grid', () => {
    const markup = render()
    expect(markup).not.toContain('<h3')
    expect(markup.match(/flow-node-list-grid/g)).toHaveLength(1)
    expect(markup.match(/px-2.5 py-2/g)).toHaveLength(2)
    expect(markup).not.toContain('opacity-0')
    expect(markup.match(/text-muted-foreground hover:bg-foreground\/10 hover:text-foreground dark:hover:bg-foreground\/10/g)).toHaveLength(2)
    expect(markup.match(/aria-label="Locate this node on the canvas"/g)).toHaveLength(2)
  })
})
