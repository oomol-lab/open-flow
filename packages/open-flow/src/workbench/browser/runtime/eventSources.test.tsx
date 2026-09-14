import type { ComponentProps } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { SourceForm, SourceSelect } from './eventSources.tsx'
import { EventSourceSetup } from './eventSourceSetup.tsx'
import { createI18n } from './i18n.ts'

const source: NonNullable<ComponentProps<typeof SourceForm>['source']> = {
  version: 1,
  sourceId: 'source_demo',
  revision: 1,
  name: 'Demo events',
  provider: 'feishu_app_bot',
  appId: 'cli_demo',
  tenantKey: 'tenant',
  connectionId: 'connection',
  teamId: null,
  enabled: true,
  eventTypes: ['im.message.receive_v1'],
  manageSubscriptions: false,
  verificationTokenConfigured: true,
  encryptKeyConfigured: true,
  endpointUrl: null,
  verifiedAt: null,
  lastReceivedAt: null,
  updatedAt: '2026-09-14T00:00:00.000Z',
  consumers: [],
}
const client: ComponentProps<typeof SourceForm>['client'] = {
  createConnectorConnectionPage: async () => 'https://connector.example/providers/feishu_app_bot',
  listEventSources: async () => ({ version: 1, sources: [] }),
  listEventSourceConnections: async () => [],
  createEventSource: async () => source,
  updateEventSource: async () => source,
  deleteEventSource: async () => {},
}

it('starts with app selection without exposing authorization identity or callback credentials', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <SourceForm client={client} teams={[]} onCancel={() => {}} onSaved={() => {}} />
    </I18nProvider>,
  )
  expect(markup).toContain('Select a Feishu app')
  expect(markup).not.toContain('Verification Token')
  expect(markup).not.toContain('Encrypt Key')
  expect(markup).not.toContain('Authorization identity')
})

it('shows verified app identity as text and keeps stored callback secrets out of edit fields', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <SourceForm source={source} client={client} teams={[]} onCancel={() => {}} onSaved={() => {}} />
    </I18nProvider>,
  )
  expect(markup).toContain('App ID: cli_demo')
  expect(markup).toContain('Tenant Key: tenant')
  expect(markup).not.toContain('value="cli_demo"')
  expect(markup).not.toContain('value="tenant"')
  expect(markup.match(/type="password"/g)).toHaveLength(2)
  expect(markup).not.toContain('I confirm')
})

it('generates the default name using the selected app label', () => {
  expect(createI18n('zh-CN').t('eventSources.appSourceName', { name: 'Demo' })).toBe('Demo 事件源')
})

it('disables an empty selector so it cannot open an empty popup', () => {
  const markup = renderToStaticMarkup(<SourceSelect label="Event source" value="" options={[]} disabled={false} onChange={() => {}} />)
  expect(markup).toMatch(/<button[^>]*disabled/)
  expect(markup).not.toContain('role="listbox"')
})

it('shows the missing public callback prerequisite without offering a copy action', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <EventSourceSetup source={source} client={client} onChange={() => {}} />
    </I18nProvider>,
  )
  expect(markup).toContain(createI18n('en').t('eventSources.originMissing'))
  expect(markup).not.toContain('>Copy</button>')
  expect(markup).toContain('Selecting events here does not add them to Feishu.')
  expect(markup).toContain('No callback verification received yet.')
})

it('distinguishes verified callbacks from business event delivery', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <EventSourceSetup source={{ ...source, verifiedAt: source.updatedAt, endpointUrl: 'https://flow.example/events' }} client={client} onChange={() => {}} />
    </I18nProvider>,
  )
  expect(markup).toContain('Callback verified.')
  expect(markup).toContain('whether business events have arrived')
  expect(markup).not.toContain('No callback verification received yet.')
})
