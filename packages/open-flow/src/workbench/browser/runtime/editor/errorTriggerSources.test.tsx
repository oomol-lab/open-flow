import type { ComponentProps } from 'react'
import type { Flow } from '../api.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { afterAll, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { ErrorTriggerSources } from './errorTriggerSources.tsx'

const i18n = createI18n('zh-CN')
afterAll(() => i18n.dispose())
const published: Flow = {
  flowId: 'published',
  name: 'Orders',
  status: 'active',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  draftRevisionId: 'draft',
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
  live: { enabled: false, publicationId: 'publication', revisionId: 'revision' },
}
function render(props: Partial<ComponentProps<typeof ErrorTriggerSources>> = {}) {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <ErrorTriggerSources flows={[published]} flowId="handler" value={['missing']} onChange={vi.fn()} {...props} />
    </I18nProvider>,
  )
}

it('does not label a missing selection deleted while the catalog is incomplete or failed', () => {
  const markup = render({ complete: false })
  expect(markup).toContain('missing')
  expect(markup).not.toContain('已删除')
  expect(markup).not.toContain('移除失效上游')
})

it('distinguishes deleted, retiring and unpublished sources without treating a disabled publication as invalid', () => {
  const markup = render({
    flows: [
      published,
      { ...published, flowId: 'retiring', name: 'Billing', status: 'retiring' },
      { ...published, flowId: 'draft', name: 'Draft', live: undefined },
    ],
    value: ['published', 'missing', 'retiring', 'draft'],
  })
  expect(markup).toContain('已删除的工作流 · 已删除')
  expect(markup).toContain('Billing · 删除中')
  expect(markup).toContain('Draft · 未发布')
  expect(markup).not.toContain('Orders ·')
  expect(markup).toContain('请移除失效上游后重新发布。')
  expect(markup).toContain('移除失效上游</button>')
})

it('keeps deletion feedback visible in a read-only snapshot without offering removal', () => {
  const markup = render({ disabled: true })
  expect(markup).toContain('已删除的工作流')
  expect(markup).not.toContain('移除失效上游</button>')
})
