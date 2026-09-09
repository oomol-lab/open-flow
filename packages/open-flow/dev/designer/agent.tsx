import type { ChangeOperation, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { ConnectorAction } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { createAgentTask } from '../../src/flow/common/nodeChanges.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { AgentSettings } from '../../src/workbench/browser/runtime/editor/agentSettings.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'

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
    { modelVersion: 1, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] }, subflows: {}, tasks: {} } },
    createAgentTask({ kind: 'flow' }, { nodeId: 'agent', taskId: 'agent-task' }, 'Research agent'),
  )
  let sequence = 1
  const revision = () => ({
    actorId: 'lab',
    createdAt: timestamp,
    digest: `digest-${sequence}`,
    flowId: flow.flowId,
    modelVersion: 1,
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
      log('agent.saved', content.document.tasks['agent-task'])
      return Response.json({ revision: revision(), version: 1 })
    }
    if (url.pathname.endsWith('/check'))
      return Response.json({
        closureDigest: 'lab',
        diagnostics: [],
        engineContract: 'open-flow-engine/v2',
        flowId: flow.flowId,
        modelVersion: 1,
        revisionDigest: revision().digest,
        revisionId: revision().revisionId,
        valid: true,
        version: 1,
      })
    if (url.pathname === '/v1/connector/providers') return Response.json({ providers: [{ serviceId: 'lab', serviceName: 'Lab catalog' }], version: 1 })
    if (url.pathname === '/v1/connector/actions') return Response.json({ actions: [action], version: 1 })
    if (url.pathname === '/v1/connector/actions/lab.lookup') return Response.json({ action, version: 1 })
    if (url.pathname === '/v1/connector/connections/lab')
      return Response.json({
        serviceId: 'lab',
        connections: [
          { connectionId: 'lab-active', serviceId: 'lab', displayName: 'Lab account', isDefault: true, status: 'active' },
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

function AgentStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const logRef = useRef(log)
  logRef.current = log
  const [session, setSession] = useState<ReturnType<typeof createSession>>()
  useEffect(() => {
    const next = createSession(language, (name, value) => logRef.current(name, value))
    setSession(next)
    void next.workspace.start('agent-lab')
    return () => next.dispose()
  }, [language])
  return session == null ? null : <AgentSession key={language} session={session} dark={dark} />
}

function AgentSession({ session, dark }: { session: ReturnType<typeof createSession>; dark: boolean }) {
  const draft = useVal(session.workspace.$.draft)
  const [disabled, setDisabled] = useState(false)
  const task = draft?.content.document.tasks['agent-task']
  return (
    <I18nProvider i18n={session.i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 620, width: '100%' }}>
        <label>
          <input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} /> Read only
        </label>
        {task != null && 'executor' in task && (
          <AgentSettings
            task={task}
            nodeId="agent"
            store={session.workspace}
            connectors={session.connectors}
            disabled={disabled}
            theme={dark ? 'dark' : 'light'}
          />
        )}
      </div>
    </I18nProvider>
  )
}

export const agentStory: FrontendStory = {
  group: 'Workbench',
  id: 'agent-tools',
  title: 'Agent Tools',
  standalone: true,
  render: (log, dark, language) => <AgentStory dark={dark} language={language} log={log} />,
}
