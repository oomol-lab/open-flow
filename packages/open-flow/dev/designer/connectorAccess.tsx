import type { ConnectorAccess } from '../../src/control/common/api.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { useEffect, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { ConnectorAccount } from '../../src/workbench/browser/runtime/editor/connectionSettings.tsx'
import { ConnectorAccessSettings } from '../../src/workbench/browser/runtime/editor/connectorAccessSettings.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { createInspectorTransport } from './inspectorSession.ts'

const content: RevisionContent = {
  document: {
    bindings: {},
    graph: {
      edges: [],
      nodes: {
        mail: { inputs: {}, kind: 'task', taskId: 'mail' },
        receipt: { inputs: {}, kind: 'task', taskId: 'mail', name: 'Send receipt' },
        reminder: { inputs: {}, kind: 'task', taskId: 'mail', name: 'Send reminder' },
        pending: { inputs: {}, kind: 'task', taskId: 'pending', name: 'Send notification' },
        code: { inputs: {}, kind: 'task', name: 'Process response', task: { name: 'Process response', moduleId: 'code', inputs: [], outputs: [] } },
      },
    },
    subflows: {},
    tasks: {
      pending: { executor: { action: 'mail.send', kind: 'connector' }, inputs: [], outputs: [], name: 'Send notification' },
      mail: {
        executor: { action: 'mail.send', kind: 'connector', connectionId: 'mail-default' },
        inputs: [],
        name: 'Send mail',
        outputs: [],
      },
    },
  },
  modelVersion: currentFlowModelVersion,
  modules: { code: { name: 'Process response', source: 'export default () => ({})', imports: [] } },
}
const emptyContent: RevisionContent = {
  document: { bindings: {}, graph: { edges: [], nodes: {} }, subflows: {}, tasks: {} },
  modelVersion: currentFlowModelVersion,
  modules: {},
}
const provider = { authTypes: ['oauth2'], displayName: 'Gmail', iconUrl: 'https://static.oomol.com/logo/third-party/Gmail.svg', service: 'mail' } as const
const candidates = [
  {
    connectionId: 'mail-default',
    source: { kind: 'policy' as const, ruleId: null },
    accessBindingId: 'sha256:a9007ef9699c9703b05df0b6f32d2fbaed5ace77b7dccffa7e8252e699bd8fe5',
    connectionDisplayName: 'lishen1635-gmail-com',
    permissions: { actionIds: [], allActions: true, configured: false, proxy: true },
    permissionGroupName: null,
    providerId: 'mail',
  },
  {
    connectionId: 'mail-reviewers',
    source: { kind: 'policy' as const, ruleId: 'reviewers' },
    accessBindingId: 'sha256:b1007ef9699c9703b05df0b6f32d2fbaed5ace77b7dccffa7e8252e699bd8fe6',
    connectionDisplayName: 'lishen1635-gmail-com-2',
    permissions: {
      actionIds: ['mail.send', 'mail.read', 'mail.archive', 'mail.delete', 'mail.search'],
      allActions: false,
      configured: true,
      proxy: false,
    },
    permissionGroupName: 'Reviewers',
    providerId: 'mail',
  },
  {
    connectionId: 'mail-admin',
    source: { kind: 'admin-delegation' as const },
    accessBindingId: 'administrator-delegation',
    connectionDisplayName: 'Operations account',
    permissions: { actionIds: [], allActions: true, configured: false, proxy: true },
    permissionGroupName: null,
    providerId: 'mail',
  },
] as const

function Sample({
  access,
  dark,
  emptyFlow = false,
  label,
  loadFailed = false,
  log,
  noCandidates = false,
  noAuth = false,
  connectionStatus,
  configure = false,
  accountPending,
  language,
}: {
  readonly access: ConnectorAccess
  readonly dark: boolean
  readonly emptyFlow?: boolean
  readonly label: string
  readonly loadFailed?: boolean
  readonly log: LogAction
  readonly connectionStatus?: 'active' | 'reauth_required'
  readonly noAuth?: boolean
  readonly noCandidates?: boolean
  readonly configure?: boolean
  readonly accountPending?: 'metadata' | 'connections' | 'setup'
  readonly language: UiLanguage
}) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [store, setStore] = useState<WorkbenchStore>()
  useEffect(() => {
    const { client, flowId } = createInspectorTransport(log, emptyFlow ? emptyContent : content, {
      access,
      accessError: loadFailed,
      accessSaveDelay: 800,
      candidates: noCandidates ? [] : candidates,
      connections:
        connectionStatus == null ? [] : [{ id: 'mail-account', service: 'mail', displayName: 'Work account', isDefault: true, status: connectionStatus }],
      providers: [noAuth ? { ...provider, authTypes: ['no_auth'] } : provider, { service: 'github', displayName: 'GitHub', authTypes: ['oauth2'] }],
    })
    const next = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    setStore(next)
    void next.start(flowId).then(() => {
      if (configure) next.connectorAccess.configure('mail')
    })
    return () => next.dispose()
  }, [access, configure, connectionStatus, emptyFlow, i18n, loadFailed, log, noAuth, noCandidates])
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{label}</h3>
      <div className="grid h-[480px] overflow-hidden rounded-lg border border-border">
        <EditorContextPanel focusOnOpen={false} icon="flow" onClose={() => {}} theme={dark ? 'dark' : 'light'} title="Flow outline">
          {store != null && (
            <ConnectorAccessSettings
              onSelectReference={(reference) => log('connector-access.reference', reference)}
              onManage={(flowId) => log('connector-access.manage', flowId)}
              store={store}
            />
          )}
          {store != null && (noCandidates || accountPending != null || connectionStatus != null) && (
            <div className="p-3">
              <ConnectorAccount
                action={
                  accountPending == 'metadata'
                    ? undefined
                    : {
                        actionId: 'mail.send',
                        authenticated: true,
                        description: 'Send mail',
                        inputs: {},
                        outputs: {},
                        name: 'Send mail',
                        serviceId: 'mail',
                        serviceName: 'Mail',
                      }
                }
                actionError={undefined}
                actionId="mail.send"
                accessError={noCandidates ? i18n.t('notice.error.connectorAccessRequired') : undefined}
                activeConnections={
                  accountPending == 'setup'
                    ? []
                    : accountPending != null
                      ? undefined
                      : connectionStatus == null
                        ? []
                        : [{ connectionId: 'mail-account', displayName: 'Work account', isDefault: true, serviceId: 'mail', status: connectionStatus }]
                }
                authorizationPending={false}
                connection={undefined}
                connectionError={undefined}
                connectionId={connectionStatus == null ? undefined : 'mail-account'}
                connectors={store.connectors}
                disabled={false}
                fieldIdPrefix="unconnected-mail"
                loading={accountPending == 'setup'}
                taskId="mail"
                onConfigureAccess={() => store.connectorAccess.configure('mail')}
              />
            </div>
          )}
        </EditorContextPanel>
      </div>
    </section>
  )
}

function Gallery({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const samples: readonly {
    readonly access: ConnectorAccess
    readonly emptyFlow?: boolean
    readonly label: string
    readonly loadFailed?: boolean
    readonly connectionStatus?: 'active' | 'reauth_required'
    readonly noAuth?: boolean
    readonly noCandidates?: boolean
    readonly configure?: boolean
    readonly accountPending?: 'metadata' | 'connections' | 'setup'
  }[] = [
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      accountPending: 'setup',
      noCandidates: true,
      label: 'New node: configuring account',
    },
    ...(['metadata', 'connections'] as const).map((accountPending) => ({
      access: { accessRevision: 0, bindings: [], mode: 'implicit' as const, providerAccessDigest: 'implicit:lab', version: 1 as const },
      accountPending,
      label: `Loading account ${accountPending}`,
    })),
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      emptyFlow: true,
      configure: true,
      label: 'Configure access on request',
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'implicit', providerAccessDigest: 'implicit:lab', version: 1 },
      label: 'Deployment managed',
    },
    {
      access: {
        accessRevision: 2,
        bindings: candidates.map(({ permissions: _permissions, ...candidate }) => Object.assign(candidate, { status: 'active' as const })),
        mode: 'selectable',
        providerAccessDigest: 'selectable:2',
        version: 1,
      },
      label: 'Authorized summary',
    },
    {
      access: {
        accessRevision: 1,
        bindings: [
          {
            connectionId: 'fixture-account',
            source: { kind: 'policy' as const, ruleId: null },
            accessBindingId: candidates[0].accessBindingId,
            connectionDisplayName: candidates[0].connectionDisplayName,
            permissionGroupName: candidates[0].permissionGroupName,
            providerId: candidates[0].providerId,
            status: 'active',
          },
          {
            connectionId: 'fixture-account',
            source: { kind: 'policy' as const, ruleId: 'International finance operations reviewers' },
            accessBindingId: 'long-name',
            connectionDisplayName: 'finance-operations-international-team@example.com',
            permissionGroupName: 'International finance operations reviewers',
            providerId: 'sheets',
            status: 'active',
          },
        ],
        mode: 'selectable',
        providerAccessDigest: 'selectable:long-names',
        providerIds: ['github'],
        version: 1,
      },
      label: 'Service cards: accounts, long names and unconnected service',
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      emptyFlow: true,
      label: 'No Providers in Flow',
    },
    {
      access: {
        accessRevision: 2,
        bindings: [
          {
            connectionId: null,
            source: null,
            accessBindingId: 'retired',
            connectionDisplayName: 'Former work account',
            permissionGroupName: 'Former editors',
            providerId: 'mail',
            status: 'invalid',
          },
        ],
        mode: 'selectable',
        providerAccessDigest: 'selectable:2',
        version: 1,
      },
      label: 'Invalid selection retained',
    },
    {
      access: { accessRevision: 1, providerIds: ['mail'], bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:manual', version: 1 },
      emptyFlow: true,
      configure: true,
      label: 'Manually added service can be removed',
    },
    {
      access: { accessRevision: 2, providerIds: [], bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:removed', version: 1 },
      configure: true,
      label: 'Flow dependency with accounts available but none selected',
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      label: 'No connected accounts',
      noCandidates: true,
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      label: 'Connected account without selectable permissions',
      noCandidates: true,
      connectionStatus: 'active',
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      label: 'Account needs reconnection',
      noCandidates: true,
      connectionStatus: 'reauth_required',
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      label: 'No-auth service — authorization not required',
      noAuth: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'implicit', providerAccessDigest: 'implicit:lab', version: 1 },
      label: 'Initial load failed',
      loadFailed: true,
    },
  ]
  return (
    <I18nProvider i18n={createI18n(language)}>
      <div
        className="open-flow-workbench open-flow-theme grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-4 p-5"
        data-theme={dark ? 'dark' : 'light'}
      >
        {samples.map((sample) => (
          <Sample {...sample} dark={dark} key={sample.label} language={language} log={log} />
        ))}
      </div>
    </I18nProvider>
  )
}

export const connectorAccessStory: FrontendStory = {
  description:
    'Compact service cards with account references (first two plus expansion), pending account selection, and a dynamic code notice using production settings, with shared framing for accounts and unconnected services: expand the multiple-Provider sample and scroll to its last connection. Account saves take 800 ms so immediate checkbox feedback and the saving status can be inspected. Covers compact summaries, bounded scrolling, long names, deployment-managed, invalid binding, empty candidate, and load failure states. Each service requiring authorization has a persistent account menu with Add account and Remove authorization; empty and expired account states retain direct recovery actions. Add service opens a searchable virtual service picker at the end of the expanded list, remains available in the empty state, and can configure GitHub even when the Flow does not reference it. Node account management and add-account entries expand Flow access and focus Mail without adding inline guidance; the empty candidate sample offers the same route before authorization.',
  group: 'Workbench',
  id: 'connector-access',
  render: (log, dark, language) => <Gallery dark={dark} language={language} log={log} />,
  standalone: true,
  title: 'Services and Authorization',
}
