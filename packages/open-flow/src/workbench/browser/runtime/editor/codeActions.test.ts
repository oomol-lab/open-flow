import type { ConnectorConnection, ConnectorProvider } from '../api.ts'

import { describe, expect, it } from 'vitest'
import { availableConnectionGroups, hintedCapability } from './codeActions.tsx'

const providers: readonly ConnectorProvider[] = [
  { serviceId: 'slack', serviceName: 'Slack' },
  { serviceId: 'github', serviceName: 'GitHub' },
]

const connection = (value: Partial<ConnectorConnection> & Pick<ConnectorConnection, 'connectionId' | 'displayName' | 'serviceId'>): ConnectorConnection => ({
  isDefault: false,
  status: 'active',
  ...value,
})

describe('Code Action available connections', () => {
  it('shows only active Flow connections, grouped by Provider with defaults first', () => {
    expect(
      availableConnectionGroups(
        [
          connection({ connectionId: 'github-personal', displayName: 'Personal', serviceId: 'github' }),
          connection({ connectionId: 'slack-old', displayName: 'Old workspace', serviceId: 'slack', status: 'disconnected' }),
          connection({ connectionId: 'github-work', displayName: 'Work', isDefault: true, serviceId: 'github' }),
          connection({ connectionId: 'slack-team', displayName: 'Product', isDefault: true, serviceId: 'slack' }),
        ],
        providers,
        'en',
      ),
    ).toEqual([
      {
        serviceId: 'github',
        name: 'GitHub',
        connections: [expect.objectContaining({ connectionId: 'github-work' }), expect.objectContaining({ connectionId: 'github-personal' })],
      },
      { serviceId: 'slack', name: 'Slack', connections: [expect.objectContaining({ connectionId: 'slack-team' })] },
    ])
  })

  it('uses the Provider ID when its catalog entry is unavailable', () => {
    expect(availableConnectionGroups([connection({ connectionId: 'custom-main', displayName: 'Main', serviceId: 'custom' })], providers, 'en')).toEqual([
      { serviceId: 'custom', name: 'custom', connections: [expect.objectContaining({ connectionId: 'custom-main' })] },
    ])
  })

  it('shows only Providers actively granted to a selectable Flow', () => {
    const connections = [
      connection({ connectionId: 'github-work', displayName: 'Work', serviceId: 'github' }),
      connection({ connectionId: 'slack-team', displayName: 'Product', serviceId: 'slack' }),
    ]
    expect(
      availableConnectionGroups(connections, providers, 'en', {
        accessRevision: 1,
        bindings: [
          {
            accessBindingId: 'engineering',
            connectionDisplayName: 'Work GitHub',
            permissionGroupName: 'Engineering',
            providerId: 'github',
            status: 'active',
          },
          {
            accessBindingId: 'communications',
            connectionDisplayName: 'Team Discord',
            permissionGroupName: 'Communications',
            providerId: 'discord',
            status: 'active',
          },
        ],
        mode: 'selectable',
        providerAccessDigest: 'access-1',
        version: 1,
      }),
    ).toEqual([
      { serviceId: 'discord', name: 'discord', connections: [] },
      {
        serviceId: 'github',
        name: 'GitHub',
        connections: [expect.objectContaining({ connectionId: 'github-work' })],
      },
    ])
  })
})

describe('Code Action typing hints', () => {
  it('records selected Actions and replaces only their default Connection hint', () => {
    expect(
      hintedCapability(
        [
          {
            kind: 'connector',
            actionHints: ['github.list_repositories'],
            connectionHints: [
              { action: 'github.get_current_user', connectionId: 'old' },
              { action: 'github.get_current_user', connectionId: 'personal', alias: 'personal' },
            ],
          },
        ],
        {
          actionId: 'github.get_current_user',
          authenticated: true,
          description: '',
          inputs: {},
          name: 'Current user',
          outputs: {},
          serviceId: 'github',
          serviceName: 'GitHub',
        },
        'work',
      ),
    ).toEqual({
      kind: 'connector',
      actionHints: ['github.list_repositories', 'github.get_current_user'],
      connectionHints: [
        { action: 'github.get_current_user', connectionId: 'personal', alias: 'personal' },
        { action: 'github.get_current_user', connectionId: 'work' },
      ],
    })
  })
})
