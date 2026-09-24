import type { DiagnosticItem } from '../editor/diagnostics.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { DiagnosticsPanel } from './diagnosticsPanel.tsx'

it.each(['list_tools', '列出可用工具'])('uses the connector node title %s in connection diagnostics', (title) => {
  const i18n = createI18n('zh-CN')
  const html = renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <DiagnosticsPanel
        checking={false}
        items={[
          {
            diagnostic: {
              code: 'task.connector-connection-required',
              column: 0,
              line: 1,
              message: 'Connector Task "internal-task-id" requires an active Connection.',
              path: '/document/tasks/internal-task-id/executor/connectionId',
              values: { taskId: 'internal-task-id' },
            },
            location: { nodeId: 'connector-node', section: 'account' },
            scope: 'task',
          },
        ]}
        nodes={new Map([['connector-node', { kind: 'task', title }]])}
        onClose={() => {}}
        onRefresh={() => {}}
        onSelect={() => {}}
        onSelectNode={() => {}}
      />
    </I18nProvider>,
  )

  expect(html).toContain(`请为连接器节点“${title}”选择连接账号。`)
  expect(html).not.toContain('internal-task-id')
  i18n.dispose()
})

it('groups multiple issues for one node while leaving flow issues separate', () => {
  const items: DiagnosticItem[] = [
    {
      diagnostic: {
        code: 'trigger.connection-missing',
        column: 0,
        line: 1,
        message: 'Select a connection account for this Trigger.',
        path: '/document/graph/nodes/trigger/bindingId',
      },
      location: { nodeId: 'trigger', section: 'account' },
      scope: 'node',
    },
    {
      diagnostic: {
        code: 'trigger.config-incomplete',
        column: 0,
        fields: ['sourceId', 'eventTypes'],
        line: 1,
        message: 'Complete the required Trigger config fields: sourceId, eventTypes.',
        path: '/document/graph/nodes/trigger/config',
        values: { fields: 'sourceId, eventTypes' },
      },
      location: { nodeId: 'trigger', section: 'node' },
      message: '请完成触发器的必填配置：事件源和接收的事件。',
      scope: 'node',
    },
    {
      diagnostic: {
        code: 'trigger.config-incomplete',
        column: 0,
        fields: ['sourceId', 'eventTypes'],
        line: 1,
        message: 'Complete the required Trigger config fields: sourceId, eventTypes.',
        path: '/document/graph/nodes/second-trigger/config',
      },
      location: { nodeId: 'second-trigger', section: 'node' },
      scope: 'node',
    },
    {
      diagnostic: { code: 'custom.flow', column: 0, line: 1, message: 'Flow-level issue', path: '/document/graph' },
      scope: 'flow',
    },
  ]
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <DiagnosticsPanel
        checking={false}
        items={items}
        nodes={
          new Map([
            ['trigger', { kind: 'trigger', icon: ':carbon:event:', title: 'Application Event' }],
            ['second-trigger', { kind: 'trigger', icon: ':carbon:event:', title: 'Application Event (2)' }],
          ])
        }
        onClose={() => {}}
        onRefresh={() => {}}
        onSelect={() => {}}
        onSelectNode={() => {}}
      />
    </I18nProvider>,
  )

  expect(html.match(/diagnostics-node-group/g)).toHaveLength(2)
  expect(html).toContain('Application Event')
  expect(html).toContain('Application Event (2)')
  expect(html).toContain('请选择触发器的连接账号。')
  expect(html).toContain('请完成触发器的必填配置：事件源和接收的事件。')
  expect(html).toContain('Flow-level issue')
  expect(html.indexOf('Application Event (2)')).toBeGreaterThan(html.indexOf('请完成触发器的必填配置：事件源和接收的事件。'))
  expect(html.indexOf('Flow-level issue')).toBeGreaterThan(html.indexOf('Application Event (2)'))
  expect(html).toContain('在画布中定位Application Event')
  expect(html).toContain('其他问题')
  expect(html).not.toContain('共4个问题')
  expect(html).not.toContain('/document/graph/nodes/')
})
