import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { afterAll, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FlowDeletionImpact } from './resourceBrowser.tsx'

const i18n = createI18n('zh-CN')
afterAll(() => i18n.dispose())

it('distinguishes an empty result from loading and failed lookups', () => {
  const render = (listeners: readonly [] | undefined, failed: boolean) =>
    renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <FlowDeletionImpact listeners={listeners} failed={failed} onRetry={() => {}} />
      </I18nProvider>,
    )
  expect(render([], false)).toBe('')
  expect(render(undefined, false)).toContain('正在查询工作流错误节点')
  expect(render(undefined, true)).toContain('无法确认哪些工作流错误节点正在监听')
  expect(render(undefined, true)).toContain('重试')
})

it('identifies the published handler and node and marks disabled subscriptions', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <FlowDeletionImpact
        listeners={[{ flowId: 'handler', flowName: '故障通知', nodeId: 'error', nodeName: '订单失败告警', enabled: false }]}
        failed={false}
        onRetry={() => {}}
      />
    </I18nProvider>,
  )
  expect(markup).toContain('故障通知')
  expect(markup).toContain('订单失败告警')
  expect(markup).toContain('已停用')
  expect(markup).toContain('其他上游的监听不受影响')
})
