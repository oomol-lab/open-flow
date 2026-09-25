import type { ChangeOperation, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { ConnectorAction } from '../../src/workbench/browser/runtime/api.ts'
import type { ConnectorActionView } from '../../src/workbench/browser/runtime/connectionCatalog.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { createAgentTask, createCodeTask } from '../../src/flow/common/nodeChanges.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { AgentSettings } from '../../src/workbench/browser/runtime/editor/agentSettings.tsx'
import { CodeTaskSection } from '../../src/workbench/browser/runtime/editor/codeTaskSection.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'
import { useStoryActions } from './storyActions.tsx'

const action: ConnectorAction = {
  actionId: 'lab.lookup',
  serviceId: 'lab',
  serviceName: 'Lab catalog',
  name: 'Find records',
  description: 'Find matching records using a query and a result limit.',
  authenticated: true,
  inputs: {
    query: { jsonSchema: { type: 'string' }, nullable: false, description: 'Search query' },
    limit: { jsonSchema: { type: 'integer', minimum: 1 }, nullable: false, description: 'Maximum records' },
  },
  outputs: { records: { jsonSchema: { type: 'array', items: { type: 'object' } }, nullable: false } },
}

const actions: readonly ConnectorAction[] = [
  action,
  { ...action, actionId: 'lab.count', name: 'Count records', description: 'Count matching records.' },
  ...['Create', 'Update', 'Delete', 'Archive', 'Restore', 'Copy', 'Move', 'Export', 'Import', 'Validate', 'Tag', 'Untag'].map((operation) =>
    Object.assign({}, action, {
      actionId: `lab.${operation.toLowerCase()}`,
      name: `${operation} records`,
      description: `${operation} the selected records.`,
      inputs: {},
    }),
  ),
  {
    ...action,
    actionId: 'unconnected.create',
    serviceId: 'unconnected',
    serviceName: 'Unconnected service',
    name: 'Create record',
    description: 'This service has no connected account.',
  },
  {
    ...action,
    actionId: 'hosted.generate',
    serviceId: 'hosted',
    serviceName: 'Hosted tools',
    name: 'Generate sample',
    description: 'Use the OOMOL built-in account.',
  },
  {
    ...action,
    actionId: 'public.echo',
    serviceId: 'public',
    serviceName: 'Public tools',
    name: 'Echo',
    description: 'Return the input without an account.',
    authenticated: false,
    inputs: {},
    outputs: {},
  },
]

// Only the transport is simulated. Production stores own changes and validation.
function createSession(language: UiLanguage, log: LogAction) {
  const i18n = createI18n(language)
  const timestamp = '2026-09-09T00:00:00.000Z'
  const flow = {
    createdAt: timestamp,
    updatedAt: timestamp,
    draftRevisionId: 'revision-1',
    flowId: 'agent-lab',
    name: 'Agent Lab',
    status: 'active',
    version: 1,
  }
  let content: RevisionContent = applyFlowChanges(
    { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] }, subflows: {}, tasks: {} } },
    [
      ...createAgentTask({ kind: 'flow' }, { nodeId: 'agent', taskId: 'agent-task' }, 'Research agent'),
      ...createCodeTask({ kind: 'flow' }, { nodeId: 'code', moduleId: 'code-module' }, 'Code'),
    ],
  )
  let sequence = 1
  const revision = () => ({
    actorId: 'lab',
    createdAt: timestamp,
    digest: `digest-${sequence}`,
    flowId: flow.flowId,
    modelVersion: currentFlowModelVersion,
    parentRevisionId: sequence === 1 ? null : `revision-${sequence - 1}`,
    revisionId: `revision-${sequence}`,
    version: 1,
  })
  const client = new WorkbenchClient(async (path, init) => {
    const url = new URL(path instanceof Request ? path.url : path, 'https://lab.invalid')
    if (url.pathname === '/v1/flows') return Response.json({ flows: [flow], total: 1, version: 1 })
    if (url.pathname.endsWith('/editor'))
      return Response.json({
        flow,
        draft: { ...revision(), content },
        live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
        version: 1,
      })
    if (url.pathname.endsWith('/draft/changes')) {
      const body = JSON.parse(String(init?.body)) as { operations: ChangeOperation[] }
      content = applyFlowChanges(content, body.operations)
      sequence++
      log('node.saved', { agent: content.document.tasks['agent-task'], code: content.document.graph.nodes.code })
      return Response.json({ revision: revision(), version: 1 })
    }
    if (url.pathname.endsWith('/check'))
      return Response.json({
        closureDigest: 'lab',
        diagnostics: [],
        engineContract: 'open-flow-engine/v5',
        flowId: flow.flowId,
        modelVersion: currentFlowModelVersion,
        revisionDigest: revision().digest,
        revisionId: revision().revisionId,
        valid: true,
        version: 1,
      })
    if (url.pathname === '/v1/connector/proxy/providers')
      return Response.json({
        success: true,
        data: [
          { service: 'lab', displayName: 'Lab catalog', authTypes: ['api_key'] },
          { service: 'public', displayName: 'Public tools', authTypes: ['no_auth'] },
          { service: 'hosted', displayName: 'Hosted tools', authTypes: ['api_key'] },
          { service: 'unconnected', displayName: 'Unconnected service', authTypes: ['api_key'] },
          ...Array.from({ length: 1000 }, (_, index) => ({
            service: `sample-${index}`,
            displayName: `Sample service ${String(index + 1).padStart(4, '0')}`,
            authTypes: ['no_auth'],
          })),
        ],
      })
    if (url.pathname === '/v1/connector/action-metadata') {
      const query = url.searchParams.get('q')?.toLowerCase() ?? ''
      return Response.json({
        actions: actions.filter((item) => `${item.name} ${item.serviceName} ${item.description}`.toLowerCase().includes(query)),
        version: 1,
      })
    }
    if (url.pathname === '/v1/connector/proxy/actions')
      return Response.json({
        success: true,
        data: actions
          .filter((item) => !url.searchParams.has('service') || url.searchParams.get('service') == item.serviceId)
          .map((item) => ({
            id: item.actionId,
            service: item.serviceId,
            name: item.name,
            description: item.description,
            authenticated: item.authenticated,
            inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(item.inputs).map(([name, port]) => [name, port.jsonSchema])) },
            outputSchema: { type: 'object', properties: {} },
          })),
      })
    if (url.pathname === '/v1/connector/connections')
      return Response.json({
        connections: [
          { connectionId: 'lab-active', serviceId: 'lab', displayName: 'sellersprite-mcp-9b2448-production-team', isDefault: true, status: 'active' },
          { connectionId: 'hosted-default', serviceId: 'hosted', displayName: 'OOMOL Marketplace', builtInAccount: true, isDefault: true, status: 'active' },
          { connectionId: 'lab-other', serviceId: 'lab', displayName: 'Second account', isDefault: false, status: 'active' },
          { connectionId: 'lab-expired', serviceId: 'lab', displayName: 'Expired account', isDefault: false, status: 'reauth_required' },
        ],
        version: 1,
      })
    throw new Error(`Unsupported Lab request: ${url.pathname}`)
  })
  const workspace = new WorkspaceStore(client, (notice) => log('agent.notice', notice), undefined, i18n)
  const connectors = new ConnectorStore(client, workspace, (notice) => log('agent.notice', notice), { openExternalPage: async () => false }, i18n)
  return {
    i18n,
    workspace,
    connectors,
    dispose() {
      connectors.dispose()
      workspace.dispose()
      i18n.dispose()
    },
  }
}

function AgentStory({ dark, language, log, code = false }: { dark: boolean; language: UiLanguage; log: LogAction; code?: boolean }) {
  const logRef = useRef(log)
  logRef.current = log
  const [session, setSession] = useState<ReturnType<typeof createSession>>()
  useEffect(() => {
    const next = createSession(language, (name, value) => logRef.current(name, value))
    setSession(next)
    void next.workspace.start('agent-lab').then(() => {
      if (code) next.workspace.selectNodes(['code'])
    })
    return () => next.dispose()
  }, [language, code])
  return session == null ? null : <AgentSession key={language} session={session} dark={dark} code={code} />
}

function AgentSession({ session, dark, code }: { session: ReturnType<typeof createSession>; dark: boolean; code: boolean }) {
  const draft = useVal(session.workspace.$.draft)
  const [disabled, setDisabled] = useState(false)
  const [slow, setSlow] = useState(false)
  const failNext = useRef(false)
  const prepareAction = async (selectedAction: ConnectorActionView) => {
    const fail = failNext.current
    failNext.current = false
    if (slow) await new Promise((resolve) => setTimeout(resolve, 2500))
    if (fail) throw new Error('Simulated account loading failure')
    return session.connectors.resolveAction(selectedAction.actionId)
  }
  const task = draft?.content.document.tasks['agent-task']
  const revision = useVal(session.workspace.$.revision)
  const selection = revision?.node({ kind: 'flow' }, 'code')
  useStoryActions([
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled((value) => !value) },
    { label: slow ? 'Normal preparation' : 'Slow preparation', onClick: () => setSlow((value) => !value) },
    {
      label: 'Fail next preparation',
      onClick: () => {
        failNext.current = true
      },
    },
  ])
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 620, width: '100%' }}>
        {code && selection?.kind == 'task' && (
          <CodeTaskSection
            selection={selection}
            store={session.workspace}
            connectors={session.connectors}
            prepareAction={prepareAction}
            disabled={disabled}
            theme={dark ? 'dark' : 'light'}
          />
        )}
        {!code && task != null && 'executor' in task && (
          <AgentSettings
            task={task}
            nodeId="agent"
            store={session.workspace}
            connectors={session.connectors}
            prepareAction={prepareAction}
            disabled={disabled}
            theme={dark ? 'dark' : 'light'}
          />
        )}
      </div>
    </I18nProvider>
  )
}

export const agentStory: FrontendStory = {
  description:
    'Browse services, check actions without removing them from the list, and choose accounts in the selected rows. Select Hosted tools to check the localized OOMOL Built-in account name and verification icon. Use slow preparation and failure controls to check immediate selection, independent row loading, removal and retry. Expand a tool parameter and remove an earlier tool to check that the editor stays open. Compare parameter drafts, Save, Cancel and read-only controls.',
  group: 'Node Agent',
  id: 'agent-tools',
  propertyPanel: true,
  title: 'Agent Tools',
  standalone: true,
  render: (log, dark, language) => <AgentStory dark={dark} language={language} log={log} />,
}

export const codeActionsStory: FrontendStory = {
  ...agentStory,
  description:
    'Open Actions from the plus button in the Code heading; saved selections show up to three distinct overlapping provider icons with the total action count as the final circle. Select multiple actions from one service to check icon deduplication and the tooltip counts. Browse services grouped by connected, built-in account, no setup and not connected, then check actions. Selected rows use an unlabeled account selector aligned with the action title in the middle column, leaving the delete button in its own column, with the property panel control surface; the header refreshes accounts and trash buttons remove actions. Icon buttons have tooltips. Use slow preparation and failure controls to check immediate selection, concurrent rows, removal and retry. Check opening with 1,000 sample services, the centered empty state, text-only provider header, shared node-picker icons, selected action hierarchy, overlay scrolling, 13px type, saving without accounts, danger on the Code Actions button for account issues, warning account controls, an Add account button for empty accounts, issues sorted first only on initial load, stable order while editing, original selection order preserved on Save, Cancel and account-free actions.',
  group: 'Node Task',
  id: 'code-actions',
  title: 'Service actions',
  render: (log, dark, language) => <AgentStory dark={dark} language={language} log={log} code />,
}
