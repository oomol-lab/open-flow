import type { ComponentProps } from 'react'
import type { ConnectorStore } from '../stores/connectorStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { ConnectorAccount } from './connectionSettings.tsx'

const i18n = createI18n('zh-CN')
function renderAccount(overrides: Partial<ComponentProps<typeof ConnectorAccount>> = {}) {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <ConnectorAccount
        action={{
          actionId: 'gmail.fetch_emails',
          authenticated: true,
          description: 'Read mail',
          inputs: {},
          outputs: {},
          name: 'Read mail',
          serviceId: 'gmail',
          serviceName: 'Gmail',
        }}
        actionError={undefined}
        actionId="gmail.fetch_emails"
        accessError={i18n.t('notice.error.connectorAccessRequired')}
        activeConnections={[]}
        authorizationPending={false}
        connection={undefined}
        connectionError={undefined}
        connectionId={undefined}
        connectors={{ connect: vi.fn() } as unknown as ConnectorStore}
        disabled={false}
        fieldIdPrefix="mail"
        loading={false}
        taskId="mail"
        onConfigureAccess={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  )
}

it.each(['metadata', 'connections'] as const)('shows loading while waiting for %s without a refresh call', (pending) => {
  const markup = renderAccount({
    ...(pending == 'metadata' ? { action: undefined } : {}),
    accessError: undefined,
    activeConnections: undefined,
  })
  expect(markup).toContain(i18n.t('inspector.account.loading'))
  expect(markup).not.toContain('重试')
  expect(markup).not.toContain('暂时无法获取')
  expect(markup).not.toContain('连接 Gmail')
  expect(markup).not.toContain('选择可用账号')
})

it.each([undefined, { message: 'Earlier request failed.' }])('directs missing access to configuration instead of retrying (%s)', (actionError) => {
  const markup = renderAccount({ actionError })
  expect(markup).toContain('运行前，请为此 Flow 选择可用账号和权限。')
  expect(markup).toContain('选择可用账号')
  expect(markup).toContain('管理账号')
  expect(markup).not.toContain('重试')
  expect(markup).not.toContain('继承')
  expect(markup).not.toContain('Provider')
})

it('offers retry for a metadata failure without presenting unrelated access configuration', () => {
  const markup = renderAccount({ action: undefined, accessError: undefined, actionError: { message: '服务暂时不可用。' } })
  expect(markup).toContain('服务暂时不可用。')
  expect(markup).toContain('重试')
  expect(markup).not.toContain('选择可用账号')
})

it.each(['connector.access-required', 'connector.access-invalid'])('offers access configuration when metadata returns %s', (code) => {
  const markup = renderAccount({ action: undefined, accessError: undefined, actionError: { code, message: '需要选择可用账号。' } })
  expect(markup).toContain('选择可用账号')
  expect(markup).not.toContain('重试')
})

it('asks an administrator for help when the current user is denied permission', () => {
  const markup = renderAccount({ action: undefined, accessError: undefined, actionError: { code: 'authorization.denied', message: 'Denied.' } })
  expect(markup).toContain('请联系管理员')
  expect(markup).not.toContain('重试')
  expect(markup).not.toContain('选择可用账号')
})

it('shows a neutral loading account section while a newly added node is being configured', () => {
  const markup = renderAccount({ loading: true })
  expect(markup).toContain(i18n.t('inspector.account.loading'))
  expect(markup).toContain(i18n.t('inspector.account.title'))
  expect(markup).not.toContain(i18n.t('inspector.account.accessTitle'))
  expect(markup).not.toContain(i18n.t('notice.error.connectorAccessRequired'))
  expect(markup).not.toContain('选择可用账号')
})
