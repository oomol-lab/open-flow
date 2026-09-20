import type { ConnectorAccess } from '../../src/control/common/api.ts'
import type { RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { useEffect, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { ConnectorAccessSettings } from '../../src/workbench/browser/runtime/editor/connectorAccessSettings.tsx'
import { EditorContextPanel } from '../../src/workbench/browser/runtime/editor/editorContextPanel.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { createInspectorTransport } from './inspectorSession.ts'

const content: RevisionContent = {
  document: {
    bindings: {},
    graph: { edges: [], nodes: { mail: { inputs: {}, kind: 'task', taskId: 'mail' } } },
    subflows: {},
    tasks: {
      mail: {
        executor: { action: 'mail.send', kind: 'connector' },
        inputs: [],
        name: 'Send mail',
        outputs: [],
      },
    },
  },
  modelVersion: currentFlowModelVersion,
  modules: {},
}
const emptyContent: RevisionContent = {
  document: { bindings: {}, graph: { edges: [], nodes: {} }, subflows: {}, tasks: {} },
  modelVersion: currentFlowModelVersion,
  modules: {},
}
const provider = { authTypes: ['oauth2'], displayName: 'Mail', service: 'mail' } as const
const candidates = [
  {
    accessBindingId: 'sha256:a9007ef9699c9703b05df0b6f32d2fbaed5ace77b7dccffa7e8252e699bd8fe5',
    connectionDisplayName: 'lishen1635-gmail-com',
    permissions: { actionIds: [], allActions: true, configured: false, proxy: true },
    permissionGroupName: null,
    providerId: 'mail',
  },
  {
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
] as const

function Sample({
  access,
  dark,
  emptyFlow = false,
  label,
  loadFailed = false,
  log,
  noCandidates = false,
  language,
}: {
  readonly access: ConnectorAccess
  readonly dark: boolean
  readonly emptyFlow?: boolean
  readonly label: string
  readonly loadFailed?: boolean
  readonly log: LogAction
  readonly noCandidates?: boolean
  readonly language: UiLanguage
}) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [store, setStore] = useState<WorkbenchStore>()
  useEffect(() => {
    const { client, flowId } = createInspectorTransport(log, emptyFlow ? emptyContent : content, {
      access,
      accessError: loadFailed,
      candidates: noCandidates ? [] : candidates,
      providers: [provider],
    })
    const next = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    setStore(next)
    void next.start(flowId)
    return () => next.dispose()
  }, [access, emptyFlow, i18n, loadFailed, log, noCandidates])
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{label}</h3>
      <div className="grid h-[330px] overflow-hidden rounded-lg border border-border">
        <EditorContextPanel focusOnOpen={false} icon="flow" onClose={() => {}} theme={dark ? 'dark' : 'light'} title="Flow outline">
          {store != null && <ConnectorAccessSettings onManage={(flowId) => log('connector-access.manage', flowId)} store={store} />}
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
    readonly noCandidates?: boolean
  }[] = [
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
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      emptyFlow: true,
      label: 'No Providers in Flow',
    },
    {
      access: {
        accessRevision: 2,
        bindings: [
          {
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
      access: { accessRevision: 0, bindings: [], mode: 'selectable', providerAccessDigest: 'selectable:0', version: 1 },
      label: 'No available groups',
      noCandidates: true,
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
    'Flow-level Provider access using production settings: compact authorization summary, expandable permission details, deployment-managed, invalid retained binding, empty candidate, and load failure states.',
  group: 'Workbench',
  id: 'connector-access',
  render: (log, dark, language) => <Gallery dark={dark} language={language} log={log} />,
  standalone: true,
  title: 'External Access',
}
