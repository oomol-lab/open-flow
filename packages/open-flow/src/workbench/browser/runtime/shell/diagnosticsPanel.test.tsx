import type { DiagnosticItem } from '../editor/diagnostics.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { DiagnosticsPanel } from './diagnosticsPanel.tsx'

describe('Diagnostics Panel', () => {
  it('groups located problems by node', () => {
    const items: readonly DiagnosticItem[] = [
      {
        diagnostic: {
          code: 'graph.node-output-incompatible',
          column: 0,
          line: 1,
          message: 'An upstream output is not compatible with this input.',
          path: '/document/graph/nodes/target/inputs/value',
        },
        location: { nodeId: 'target', section: 'inputs' },
        scope: 'node',
      },
      {
        diagnostic: {
          code: 'graph.input-missing',
          column: 0,
          line: 1,
          message: 'The node does not expose this input.',
          path: '/document/graph/nodes/target/inputs/missing',
          values: { handle: 'missing', nodeId: 'target' },
        },
        location: { nodeId: 'target', section: 'inputs' },
        scope: 'node',
      },
      {
        diagnostic: {
          code: 'trigger.config-incomplete',
          column: 0,
          line: 1,
          message: 'Complete the required Trigger config fields.',
          path: '/document/graph/nodes/trigger/config',
          values: { fields: 'owner, repo, events' },
        },
        location: { nodeId: 'trigger', section: 'trigger' },
        scope: 'node',
      },
    ]
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <DiagnosticsPanel
          checked
          checking={false}
          items={items}
          nodes={
            new Map([
              ['target', { title: 'Generate answer' }],
              ['trigger', { title: 'Repository event' }],
            ])
          }
          onClose={() => undefined}
          onRefresh={() => undefined}
          onSelect={() => undefined}
        />
      </I18nProvider>,
    )

    expect(markup.match(/Node ID: target/g)).toHaveLength(1)
    expect(markup.match(/Node ID: trigger/g)).toHaveLength(1)
    expect(markup).toContain('Generate answer')
    expect(markup).toContain('Repository event')
    expect(markup).toContain('Node &quot;target&quot; does not expose input &quot;missing&quot;.')
    expect(markup).toContain('Complete the required Trigger config fields: owner, repo, events.')
  })
})
