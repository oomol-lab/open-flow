import type { ConnectorAccess } from '../../src/control/common/api.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { useEffect, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { ConnectorAccount } from '../../src/workbench/browser/runtime/editor/connectionSettings.tsx'
import { CodeConnectionSettings, ConnectionUsageButton, ConnectorAccessSettings } from '../../src/workbench/browser/runtime/editor/connectorAccessSettings.tsx'
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
        receipt: { inputs: {}, kind: 'task', taskId: 'mail', name: 'Send receipt', icon: ':twemoji:receipt:' },
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
const overviewContent: RevisionContent = {
  ...content,
  document: {
    ...content.document,
    graph: {
      ...content.document.graph,
      nodes: {
        ...content.document.graph.nodes,
        issue: { inputs: {}, kind: 'task', taskId: 'issue' },
      },
    },
    tasks: {
      ...content.document.tasks,
      issue: { name: 'Create issue', inputs: [], outputs: [], executor: { kind: 'connector', action: 'github.create_issue', connectionId: 'github-work' } },
    },
  },
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
    isDefault: true,
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

function connectionHref(_flowId: string, providerId: string, connectionId?: string): string {
  const url = new URL(`https://console.oomol.com/team/demo/connections/${encodeURIComponent(providerId)}`)
  if (connectionId != null) url.searchParams.set('app', connectionId)
  return url.href
}

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
  canvasControl = false,
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
  readonly canvasControl?: boolean
  readonly language: UiLanguage
}) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [store, setStore] = useState<WorkbenchStore>()
  useEffect(() => {
    const { client, flowId } = createInspectorTransport(log, emptyFlow ? emptyContent : label == 'Node and Code usage overview' ? overviewContent : content, {
      access,
      published: label == 'Node and Code usage overview',
      accessError: loadFailed,
      accessSaveDelay: 800,
      candidates: noCandidates ? [] : candidates,
      connections:
        connectionStatus == null
          ? noCandidates
            ? []
            : [
                ...(label == 'Node and Code usage overview'
                  ? [{ id: 'github-work', service: 'github', displayName: 'Engineering', isDefault: true, status: 'active' as const }]
                  : []),
                ...candidates.map((candidate, index) => ({
                  id: candidate.connectionId,
                  service: candidate.providerId,
                  displayName: candidate.connectionDisplayName,
                  isDefault: index == 0,
                  status: 'active' as const,
                })),
              ]
          : [{ id: 'mail-account', service: 'mail', displayName: 'Work account', isDefault: true, status: connectionStatus }],
      providers: [noAuth ? { ...provider, authTypes: ['no_auth'] } : provider, { service: 'github', displayName: 'GitHub', authTypes: ['oauth2'] }],
    })
    const next = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    setStore(next)
    void next.start(flowId).then(() => {
      if (configure) next.connectorAccess.configure('mail')
    })
    return () => next.dispose()
  }, [access, configure, connectionStatus, emptyFlow, i18n, label, loadFailed, log, noAuth, noCandidates])
  return (
    <section className={canvasControl ? 'col-span-full' : undefined}>
      <h3 className="mb-2 text-sm font-medium">{label}</h3>
      <div className="grid h-[480px] overflow-hidden rounded-lg border border-border">
        {canvasControl && store != null ? (
          <FlowCanvasView
            identity="connection-usage"
            dark={dark}
            language={language}
            editable={false}
            ignoredNodeIds={[]}
            onIgnoreNodes={() => {}}
            model={{ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }}
            cornerTools={
              <ConnectionUsageButton
                connectionHref={connectionHref}
                store={store}
                onSelectReference={(reference) => log('connector-access.reference', reference)}
              />
            }
            onAddNode={() => undefined}
            onConnect={() => {}}
            onDisconnect={() => {}}
            onDeleteNodes={() => {}}
            onDuplicate={() => {}}
            onMoveNodes={() => {}}
            onMoveViewport={() => {}}
            onCopy={() => {}}
            onPaste={() => {}}
            onSelectionChange={() => {}}
            selectedNodeIds={[]}
          />
        ) : (
          <EditorContextPanel focusOnOpen={false} icon="flow" onClose={() => {}} theme={dark ? 'dark' : 'light'} title={i18n.t('connectionUsage.title')}>
            {store != null &&
              (configure ? (
                <CodeConnectionSettings store={store} onManage={(flowId) => log('code-connections.manage', flowId)} />
              ) : (
                <ConnectorAccessSettings
                  connectionHref={connectionHref}
                  onSelectReference={(reference) => log('connector-access.reference', reference)}
                  onManage={(flowId) => log('connector-access.manage', flowId)}
                  store={store}
                />
              ))}
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
                  onConfigureAccess={() => void store.connectors.connect('mail')}
                />
              </div>
            )}
          </EditorContextPanel>
        )}
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
    readonly canvasControl?: boolean
  }[] = [
    {
      access: {
        accessRevision: 2,
        bindings: [
          ...candidates.map((candidate) => ({
            accessBindingId: candidate.accessBindingId,
            connectionId: candidate.connectionId,
            connectionDisplayName: candidate.connectionDisplayName,
            permissionGroupName: candidate.permissionGroupName,
            providerId: candidate.providerId,
            source: candidate.source,
            status: 'active' as const,
          })),
          {
            accessBindingId: 'github-work-binding',
            connectionId: 'github-work',
            connectionDisplayName: 'Engineering',
            permissionGroupName: null,
            providerId: 'github',
            source: { kind: 'policy', ruleId: null },
            status: 'active',
          },
        ],
        mode: 'selectable',
        sharedAccessDigest: 'selectable:2',
        version: 1,
      },
      canvasControl: true,
      label: 'Node and Code usage overview',
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      canvasControl: true,
      emptyFlow: true,
      label: 'Connections control without issues',
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      accountPending: 'setup',
      noCandidates: true,
      label: 'New node: configuring account',
    },
    ...(['metadata', 'connections'] as const).map((accountPending) => ({
      access: { accessRevision: 0, bindings: [], mode: 'implicit' as const, sharedAccessDigest: 'implicit:lab', version: 1 as const },
      accountPending,
      label: `Loading account ${accountPending}`,
    })),
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      emptyFlow: true,
      configure: true,
      label: 'Configure access on request',
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'implicit', sharedAccessDigest: 'implicit:lab', version: 1 },
      label: 'Deployment managed',
    },
    {
      access: {
        accessRevision: 1,
        bindings: [
          {
            connectionId: 'mail-default',
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
        sharedAccessDigest: 'selectable:long-names',
        providerIds: ['github'],
        version: 1,
      },
      label: 'Service cards: accounts, long names and unconnected service',
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
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
        sharedAccessDigest: 'selectable:2',
        version: 1,
      },
      label: 'Invalid selection retained',
    },
    {
      access: { accessRevision: 1, providerIds: ['mail'], bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:manual', version: 1 },
      emptyFlow: true,
      configure: true,
      label: 'Manually added service can be removed',
    },
    {
      access: { accessRevision: 2, providerIds: [], bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:removed', version: 1 },
      configure: true,
      label: 'Flow dependency with accounts available but none selected',
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      label: 'No connected accounts',
      noCandidates: true,
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      label: 'Connected account without selectable permissions',
      noCandidates: true,
      connectionStatus: 'active',
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      label: 'Account needs reconnection',
      noCandidates: true,
      connectionStatus: 'reauth_required',
      configure: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'selectable', sharedAccessDigest: 'selectable:0', version: 1 },
      label: 'No-auth service — authorization not required',
      noAuth: true,
    },
    {
      access: { accessRevision: 0, bindings: [], mode: 'implicit', sharedAccessDigest: 'implicit:lab', version: 1 },
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
    'Compare the Connections control with an issue and without one. The plug icon uses a subtle warning color when the draft needs connection attention. Open Connections from the canvas control island. Compare service spacing, separate account cards, account icons and node icons, including a custom receipt icon. Provider and account links use 13px names and aligned leading icons; node names use 13px and supporting text uses 12px. Subtle curved branches connect accounts to their nodes. Missing account selections use a warning surface and label. The panel scrollbar appears while scrolling and hides when idle. Locate each usage, switch to the read-only publication snapshot, and stop using an account with a compact confirmation showing the same account and node hierarchy. The gallery also covers missing accounts, empty drafts, loading failures, long names and independent Code connection settings. Code selection saves take 800 ms.',
  group: 'Workbench',
  id: 'connector-access',
  render: (log, dark, language) => <Gallery dark={dark} language={language} log={log} />,
  standalone: true,
  title: 'Connections and Code access',
}
