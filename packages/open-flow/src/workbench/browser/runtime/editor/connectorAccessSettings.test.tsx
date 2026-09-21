import type { RevisionView } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { connectorAccessPermissionGroupLabel, connectorAccessPermissionLabel } from './connectorAccessPresentation.ts'
import { ConnectorAccessEmptyState, ConnectorAccessSettings } from './connectorAccessSettings.tsx'

describe('Connector access settings', () => {
  it.each(['no-auth', 'mixed', 'loading'] as const)('handles %s provider authorization requirements', (scenario) => {
    const store = {
      connectorAccess: {
        $: val({
          access: {
            bindings: [{ providerId: 'oomol_rag', status: 'active' }, ...(scenario == 'mixed' ? [{ providerId: 'mail', status: 'active' }] : [])],
            mode: 'selectable',
          },
          candidates: {},
          candidateErrors: [],
          loading: false,
          loadingCandidates: [],
        }),
      },
      workspace: {
        $: {
          flowId: val('flow-1'),
          revision: val({ connectorProviderIds: new Set(['oomol_rag', ...(scenario == 'mixed' ? ['mail'] : [])]) }),
        },
        catalogs: {
          providers: {
            get: () =>
              val({
                data:
                  scenario == 'loading'
                    ? undefined
                    : [
                        { serviceId: 'oomol_rag', serviceName: 'OOMOL Knowledge Base', noSetup: true },
                        { serviceId: 'mail', serviceName: 'Mail', noSetup: false },
                      ],
                refreshing: scenario == 'loading',
              }),
          },
        },
      },
    } as unknown as WorkbenchStore
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessSettings store={store} />
      </I18nProvider>,
    )

    if (scenario == 'no-auth') {
      expect(markup).toContain('None of the services in this flow require authorization')
      expect(markup).not.toContain('No accounts authorized yet')
      expect(markup).not.toContain('Authorized accounts:')
    }
    if (scenario == 'mixed') expect(markup).toContain('Authorized accounts: 1 across 1 services')
    if (scenario == 'loading') {
      expect(markup).toContain('Loading access')
      expect(markup).not.toContain('Authorized accounts:')
    }
  })

  it('distinguishes a permission group from its connection', () => {
    const t = createI18n('en').t

    expect(connectorAccessPermissionGroupLabel({ permissionGroupName: null }, t)).toBe('Permission group: Team default')
    expect(connectorAccessPermissionGroupLabel({ permissionGroupName: 'Editors' }, t)).toBe('Permission group: Editors')
    expect(connectorAccessPermissionGroupLabel({}, t)).toBe('Permission group: Saved permission group')
  })

  it('summarizes permission group contents without exposing its configuration', () => {
    const t = createI18n('en').t

    expect(connectorAccessPermissionLabel({ permissions: { actionIds: [], allActions: true, configured: false, proxy: true }, providerId: 'mail' }, t)).toBe(
      'All Actions · API proxy',
    )
    expect(
      connectorAccessPermissionLabel(
        {
          permissions: {
            actionIds: ['mail.send', 'mail.read', 'mail.archive', 'mail.delete'],
            allActions: false,
            configured: true,
            proxy: false,
          },
          providerId: 'mail',
        },
        t,
      ),
    ).toBe('send, read, archive and 1 more · Managed access configuration')
  })

  it('shows a retryable error instead of loading forever after the initial request fails', () => {
    const store = {
      connectorAccess: {
        $: val({ candidates: {}, candidateErrors: [], loading: false, loadingCandidates: [] }),
        load() {},
      },
      workspace: {
        $: { flowId: val('flow-1'), revision: val(undefined) },
        catalogs: { providers: { get: () => val({ data: [], refreshing: false }) } },
      },
    } as unknown as WorkbenchStore

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessSettings store={store} />
      </I18nProvider>,
    )

    expect(markup).toContain('Service authorization could not be loaded.')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('Loading access')
  })

  it('summarizes authorized connections without listing every connection by default', () => {
    const revision = {
      connectorActionIds: new Set(['mail.send']),
      connectorProviderIds: new Set(['mail']),
      revision: {
        content: {
          document: {
            graph: { edges: [], nodes: {} },
            subflows: {},
          },
        },
      },
    } as unknown as RevisionView
    const store = {
      connectorAccess: {
        $: val({
          access: {
            accessRevision: 1,
            bindings: [
              {
                accessBindingId: 'mail-work',
                connectionDisplayName: 'Work Mail',
                permissionGroupName: null,
                providerId: 'mail',
                status: 'active',
              },
              {
                accessBindingId: 'mail-personal',
                connectionDisplayName: 'Personal Mail',
                permissionGroupName: 'Personal',
                providerId: 'mail',
                status: 'active',
              },
              {
                accessBindingId: 'chat-access',
                connectionDisplayName: 'Work Slack',
                permissionGroupName: 'Chat access',
                providerId: 'slack',
                status: 'active',
              },
            ],
            mode: 'selectable',
            providerAccessDigest: 'digest',
            version: 1,
          },
          candidates: {
            mail: {
              candidates: [
                { accessBindingId: 'mail-work', connectionDisplayName: 'Work Mail', permissionGroupName: null, providerId: 'mail' },
                { accessBindingId: 'mail-personal', connectionDisplayName: 'Personal Mail', permissionGroupName: 'Personal', providerId: 'mail' },
              ],
              mode: 'selectable',
              providerId: 'mail',
              version: 1,
            },
          },
          candidateErrors: [],
          loading: false,
          loadingCandidates: [],
        }),
      },
      workspace: {
        $: { flowId: val('flow-1'), revision: val(revision) },
        catalogs: {
          providers: {
            get: () =>
              val({
                data: [
                  { serviceId: '17track', serviceName: '17TRACK' },
                  { serviceId: 'mail', serviceName: 'Mail' },
                  { serviceId: 'slack', serviceName: 'Slack' },
                ],
                refreshing: false,
              }),
          },
        },
      },
    } as unknown as WorkbenchStore

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessSettings store={store} />
      </I18nProvider>,
    )

    expect(markup).toContain('Authorized accounts: 3 across 2 services')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls=')
    expect(markup).not.toContain('Connection: Work Slack')
    expect(markup).not.toContain('Connection: Work Mail · Permission group: Team default')
    expect(markup).not.toContain('Connection: Personal Mail · Permission group: Personal')
    expect(markup).not.toContain('17TRACK')
  })
})

describe('Connector account recovery', () => {
  it.each([
    { connections: [], message: 'No accounts connected yet.', button: 'Connect account' },
    { connections: [{ status: 'active' }], message: 'Ask an administrator to grant access.', button: undefined },
    { connections: [{ status: 'reauth_required' }], message: 'Please reconnect.', button: 'Reconnect' },
    { connections: [{ status: 'disconnected' }], message: 'Please reconnect.', button: 'Reconnect' },
    { connections: [{ status: 'error' }], message: 'Please reconnect.', button: 'Reconnect' },
    { connections: undefined, message: 'Loading access', button: undefined },
  ])('shows the correct next step for $connections', ({ connections, message, button }) => {
    const store = {
      workspace: { catalogs: { connections: { get: () => val({ data: connections }) } } },
    } as unknown as WorkbenchStore
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessEmptyState store={store} serviceId="mail" />
      </I18nProvider>,
    )
    expect(markup).toContain(message)
    if (button == null) expect(markup).not.toContain('<button')
    else expect(markup).toContain(button)
  })

  it('does not mistake a failed account query for no connected accounts', () => {
    const store = {
      workspace: { catalogs: { connections: { get: () => val({ data: [], error: new Error('Unavailable') }) } } },
    } as unknown as WorkbenchStore
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessEmptyState store={store} serviceId="mail" />
      </I18nProvider>,
    )
    expect(markup).toContain('Account status could not be loaded.')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('No accounts connected yet.')
  })
})
