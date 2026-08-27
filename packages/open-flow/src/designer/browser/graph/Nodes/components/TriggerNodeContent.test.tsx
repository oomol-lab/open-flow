import type { UiLanguage } from '../../../../../localization/common/languages.ts'
import type { TriggerNodePresentation, TriggerNodeStore } from '../../../stores/node/triggerNode.store.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../../../i18n/index.ts'
import { TriggerNodeContent } from './TriggerNodeContent.tsx'

function renderTrigger(presentation: TriggerNodePresentation, language: UiLanguage): string {
  const presentation$ = val<TriggerNodePresentation | undefined>(presentation)
  const editable$ = val(true)
  const outputs$ = val([{ handle: 'payload', json_schema: { type: 'object' }, nullable: false }])
  const store = {
    changeConfig: () => undefined,
    changeSchedule: () => undefined,
    changeWebhook: () => undefined,
    display$: { editable: editable$, outputs_def: outputs$, presentation: presentation$ },
  } as unknown as TriggerNodeStore
  try {
    return renderToStaticMarkup(
      <I18nProvider i18n={createI18n(language)}>
        <TriggerNodeContent store={store} />
      </I18nProvider>,
    )
  } finally {
    presentation$.dispose()
    editable$.dispose()
    outputs$.dispose()
  }
}

describe('TriggerNodeContent', () => {
  it('makes the schedule the primary content of a polling Trigger', () => {
    const markup = renderTrigger({ kind: 'poll', schedules: [{ type: 'every', unit: 'minute', value: 5 }], source: 'github' }, 'en')

    expect(markup).toContain('Polling schedule')
    expect(markup).toContain('Polling interval')
    expect(markup).toContain('value="5"')
    expect(markup).toContain('Minutes')
    expect(markup).toContain('github')
    expect(markup).toContain('<code>payload</code>')
    expect(markup).toContain('Object')
    expect(markup).toContain('--bg:var(--edge-primitive)')
    expect(markup).not.toContain('oo-designer-node-handle')
  })

  it('renders editable Cron expression and time zone controls without the generic output editor', () => {
    const markup = renderTrigger({ kind: 'cron', schedules: [{ expression: '0 9 * * *', timezone: 'Asia/Shanghai', type: 'cron' }] }, 'zh-CN')

    expect(markup).toContain('触发计划')
    expect(markup).toMatch(/<label[^>]+for="[^"]+">Cron 表达式<\/label>/)
    expect(markup).toMatch(/<label[^>]+for="[^"]+">时区<\/label>/)
    expect(markup).toContain('0 9 * * *')
    expect(markup).toContain('Asia/Shanghai')
    expect(markup).toContain('<code>payload</code>')
    expect(markup).not.toContain('输出接口')
  })

  it('renders Provider configuration fields directly in the Trigger node', () => {
    const markup = renderTrigger(
      {
        config: [
          {
            kind: 'multi-select',
            label: 'Events',
            name: 'events',
            options: [
              { label: 'issues', source: 'issues', value: 'issues' },
              { label: 'push', source: 'push', value: 'push' },
            ],
            required: true,
            selected: ['issues'],
            source: '["issues"]',
          },
          {
            description: 'Repository name.',
            kind: 'string',
            label: 'Repository',
            name: 'repository',
            required: true,
            source: 'oomol/open-flow',
          },
        ],
        kind: 'integration',
        schedules: [],
        source: 'github',
      },
      'en',
    )

    expect(markup).toContain('Configuration')
    expect(markup).toMatch(/class="[^"]*nodrag[^"]*" data-kind="multi-select"/)
    expect(markup).toMatch(/<label[^>]*>Events \*<\/label>/)
    expect(markup).toContain('issues')
    expect(markup).toMatch(/<label[^>]+title="Repository name\."[^>]*>Repository \*<\/label>/)
    expect(markup).toContain('value="oomol/open-flow"')
  })

  it('renders Webhook payload and HTTP options directly in the Trigger node', () => {
    const markup = renderTrigger(
      {
        kind: 'webhook',
        schedules: [],
        webhook: {
          inputs: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
          options: { allowedMethods: ['POST'] },
        },
      },
      'en',
    )

    expect(markup).toContain('Payload fields')
    expect(markup).toContain('value="event"')
    expect(markup).toContain('Allowed methods')
    expect(markup).toContain('POST')
    expect(markup).toContain('Status code')
    expect(markup).not.toContain('Payload definition (JSON)')
    expect(markup).not.toContain('HTTP options (JSON)')
  })
})
