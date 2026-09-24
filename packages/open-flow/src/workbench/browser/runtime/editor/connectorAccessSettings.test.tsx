import type { RevisionView } from '../revisionView.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { connectorAccessPermissionGroupLabel, connectorAccessPermissionLabel } from './connectorAccessPresentation.ts'
import { ConnectorAccessEmptyState, CodeConnectionSettings, ConnectorAccessSettings } from './connectorAccessSettings.tsx'

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
        <CodeConnectionSettings store={store} />
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

  it.each([0, 2])('offers configuring services even with %i unreadable saved records', (discardedBindingCount) => {
    const store = {
      connectorAccess: {
        $: val({
          access: { mode: 'selectable', bindings: [], discardedBindingCount },
          candidates: {},
          candidateErrors: [],
          loading: false,
          loadingCandidates: [],
        }),
      },
      workspace: {
        $: { flowId: val('empty-flow'), revision: val({ connectorProviderIds: new Set() }) },
        catalogs: {
          providers: { get: () => val({ data: [{ serviceId: 'mail', serviceName: 'Mail' }] }) },
          connections: { get: () => val({ data: [{ connectionId: 'account', displayName: 'Work', status: 'active' }] }) },
        },
      },
    } as unknown as WorkbenchStore
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <CodeConnectionSettings store={store} />
      </I18nProvider>,
    )
    expect(markup).toContain('Add service</button>')
    expect(markup.includes('Some saved authorizations could not be read')).toBe(discardedBindingCount > 0)
    expect(markup).not.toContain('Unable to load')
  })

  it('shows node usage separately from shared Code usage without global authorization checkboxes', () => {
    const store = {
      connectorAccess: {
        $: val({
          access: {
            mode: 'selectable',
            bindings: [
              { connectionId: 'account', providerId: 'mail', connectionDisplayName: 'Work', status: 'active' },
              { connectionId: 'second-account', providerId: 'mail', connectionDisplayName: 'Personal', status: 'active' },
            ],
          },
          loading: false,
        }),
      },
      connectors: { $: { actions: val({}), connections: val([{ connectionId: 'account', displayName: 'Work' }]) } },
      workspace: {
        catalogs: {
          providers: { get: () => val({ data: [{ serviceId: 'mail', serviceName: 'Mail' }] }) },
          connections: { get: () => val({ data: [{ connectionId: 'account', displayName: 'Work', status: 'active' }] }) },
        },
        $: {
          flowId: val('flow'),
          live: val(undefined),
          revision: val({
            node: () => undefined,
            connectorReferences: {
              accounts: [{ connectionId: 'account', providerId: 'mail', nodeId: 'send', name: 'Send mail', target: { kind: 'flow' } }],
              hasCode: true,
            },
          }),
        },
      },
    } as unknown as WorkbenchStore
    const connectionHref = vi.fn(
      (flowId: string, providerId: string, connectionId?: string) =>
        `https://console.example/${flowId}/${providerId}${connectionId == null ? '' : `?app=${connectionId}`}`,
    )
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessSettings store={store} connectionHref={connectionHref} />
      </I18nProvider>,
    )
    expect(connectionHref).toHaveBeenCalledWith('flow', 'mail')
    expect(connectionHref).toHaveBeenCalledWith('flow', 'mail', 'account')
    expect(markup).toContain('href="https://console.example/flow/mail"')
    expect(markup).toContain('href="https://console.example/flow/mail?app=account"')
    expect(markup).not.toContain('disabled=""')
    expect(markup).toContain('Accounts used by this draft')
    expect(markup).toContain('Personal')
    expect(markup.match(/aria-label="Mail"/g)).toHaveLength(1)
    expect(markup).not.toContain('Current account status: Unknown')
    expect(markup).toContain('Send mail')
    expect(markup).toContain('All Code nodes can use this account')
    expect(markup).toContain('Actions for Personal')
    expect(markup).not.toContain('Configure Code')
    expect(markup).not.toContain('role="checkbox"')
    expect(markup).not.toContain('Add service')
  })

  it.each([false, true])('distinguishes missing account selections from services that need no setup (%s)', (noSetup) => {
    const store = {
      connectors: { $: { actions: val({}) } },
      connectorAccess: { $: val({ access: { version: 1, mode: 'implicit', bindings: [] }, loading: false }) },
      workspace: {
        $: {
          flowId: val('flow'),
          live: val(undefined),
          revision: val({
            node: () => undefined,
            connectorReferences: { accounts: [{ providerId: 'mail', nodeId: 'send', name: 'Send mail', kind: 'connector', target: { kind: 'flow' } }] },
          }),
        },
        catalogs: {
          providers: { get: () => val({ data: [{ serviceId: 'mail', serviceName: 'Mail', noSetup }] }) },
          connections: { get: () => val({ data: [] }) },
        },
      },
    } as unknown as WorkbenchStore
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ConnectorAccessSettings store={store} onSelectReference={() => {}} />
      </I18nProvider>,
    )
    expect(markup.includes('Needs an account')).toBe(!noSetup)
    expect(markup.includes('Send mail')).toBe(!noSetup)
    expect(markup.includes('This draft does not use any accounts.')).toBe(noSetup)
  })

  it('distinguishes a permission group from its connection', () => {
    const t = createI18n('en').t

    expect(connectorAccessPermissionGroupLabel({ source: null, permissionGroupName: 'Readers' }, t)).toBe('Reauthorization required')
    expect(connectorAccessPermissionGroupLabel({ source: { kind: 'admin-delegation' }, permissionGroupName: null }, t)).toBe('Administrator authorization')
    expect(connectorAccessPermissionGroupLabel({ source: { kind: 'policy', ruleId: null }, permissionGroupName: null }, t)).toBe('Team default permissions')
    expect(connectorAccessPermissionGroupLabel({ source: { kind: 'policy', ruleId: 'editors' }, permissionGroupName: 'Editors' }, t)).toBe(
      'Permission group: Editors',
    )
    expect(connectorAccessPermissionGroupLabel({ source: { kind: 'policy', ruleId: 'missing' } }, t)).toBe('Permission group: Saved permission group')
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
        <CodeConnectionSettings store={store} />
      </I18nProvider>,
    )

    expect(markup).toContain('Service authorization could not be loaded.')
    expect(markup).toContain('Retry')
    expect(markup).not.toContain('Loading access')
  })

  it('shows Code accounts directly without a disclosure', () => {
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
                connectionId: 'fixture-account',
                source: { kind: 'policy' as const, ruleId: null },
                accessBindingId: 'mail-work',
                connectionDisplayName: 'Work Mail',
                permissionGroupName: null,
                providerId: 'mail',
                status: 'active',
              },
              {
                connectionId: 'fixture-account',
                source: { kind: 'policy' as const, ruleId: 'Personal' },
                accessBindingId: 'mail-personal',
                connectionDisplayName: 'Personal Mail',
                permissionGroupName: 'Personal',
                providerId: 'mail',
                status: 'active',
              },
              {
                connectionId: 'fixture-account',
                source: { kind: 'policy' as const, ruleId: 'Chat access' },
                accessBindingId: 'chat-access',
                connectionDisplayName: 'Work Slack',
                permissionGroupName: 'Chat access',
                providerId: 'slack',
                status: 'active',
              },
            ],
            mode: 'selectable',
            sharedAccessDigest: 'digest',
            version: 1,
          },
          candidates: {
            mail: {
              candidates: [
                {
                  connectionId: 'fixture-account',
                  source: { kind: 'policy' as const, ruleId: null },
                  accessBindingId: 'mail-work',
                  connectionDisplayName: 'Work Mail',
                  permissionGroupName: null,
                  providerId: 'mail',
                },
                {
                  connectionId: 'fixture-account',
                  source: { kind: 'policy' as const, ruleId: 'Personal' },
                  accessBindingId: 'mail-personal',
                  connectionDisplayName: 'Personal Mail',
                  permissionGroupName: 'Personal',
                  providerId: 'mail',
                },
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
        <CodeConnectionSettings store={store} />
      </I18nProvider>,
    )

    expect(markup).toContain('Authorized accounts: 3 across 2 services')
    expect(markup).not.toContain('aria-expanded=')
    expect(markup).toContain('Add service</button>')
    expect(markup).toContain('Work Slack')
    expect(markup).toContain('Work Mail')
    expect(markup).toContain('Personal Mail')
  })
})

describe('Connector account recovery', () => {
  it.each([
    { connections: [], message: 'No accounts connected yet.', button: 'Connect account' },
    { connections: [{ status: 'active' }], message: 'Check the team’s account permission settings.', button: 'Manage accounts' },
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
