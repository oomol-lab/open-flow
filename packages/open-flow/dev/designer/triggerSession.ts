import type { ChangeOperation, RevisionContent, TriggerNode } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { WorkbenchHost } from '../../src/workbench/browser/runtime/contract.ts'
import type { LogAction } from './stories.tsx'

import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { TriggerStore } from '../../src/workbench/browser/runtime/stores/triggerStore.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'
import { triggerDraft } from './triggerFixtures.ts'

// Only local HTTP responses are fixtures. Editing and persistence use the production reducer/store.
export function createTriggerSession(
  trigger: TriggerNode,
  language: UiLanguage,
  log: LogAction,
  nodeId: string,
  create = false,
  catalog?: {
    request: (url: URL, init?: RequestInit) => Promise<Response>
    cache: WorkbenchHost['triggerCatalogCache']
  },
) {
  const i18n = createI18n(language)
  const { flow, draft } = triggerDraft(trigger)
  const { content: initialContent, ...revisionMetadata } = draft
  let content: RevisionContent = {
    ...initialContent,
    document: {
      ...initialContent.document,
      bindings: create ? {} : initialContent.document.bindings,
      graph: { nodes: create ? {} : { [nodeId]: trigger }, edges: [] },
    },
  }
  let sequence = 1
  const revision = () => ({
    ...revisionMetadata,
    revisionId: `revision-${sequence}`,
    parentRevisionId: sequence === 1 ? null : `revision-${sequence - 1}`,
    digest: `lab-${sequence}`,
  })
  const serviceId = trigger.kind === 'poll' || trigger.kind === 'integration' ? trigger.definition.provider : 'lab'
  const account = { connectionId: 'lab-account', serviceId, displayName: 'Design team', isDefault: true, status: 'active' as const }
  const client = new WorkbenchClient(async (path, init) => {
    const url = new URL(path instanceof Request ? path.url : path, 'https://lab.invalid')
    if (url.pathname === '/v1/trigger-keys/catalog' && catalog != null) return catalog.request(url, init)
    if (url.pathname === '/v1/flows') return Response.json({ flows: [flow], total: 1, version: 1 })
    if (url.pathname.endsWith('/editor'))
      return Response.json({
        flow,
        draft: { ...revision(), content },
        live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        presentation: { revision: 1, updatedAt: flow.updatedAt, value: {}, version: 1 },
        version: 1,
      })
    if (url.pathname.includes('/options/')) {
      const failed = trigger.kind == 'poll' && trigger.definition.provider == 'linear' && trigger.config.teamId === '00000000-0000-4000-8000-000000000099'
      if (failed) return Response.json({ error: { code: 'connector.unavailable', message: 'Sample connection failure.' }, version: 1 }, { status: 503 })
      const options = url.pathname.endsWith('/teamId')
        ? [
            { value: '72b2a2dc-6f4f-4423-9d34-24b5bd10634a', label: 'Engineering (ENG)' },
            { value: '00000000-0000-4000-8000-000000000002', label: 'Design (DES)' },
          ]
        : [
            { value: '00000000-0000-4000-8000-000000000003', label: 'In Progress', color: '#f2c94c' },
            { value: '539068e2-ae88-4d09-bd75-22eb4a59612f', label: 'Done', color: '#5e6ad2' },
          ]
      const current = content.document.graph.nodes[nodeId]
      if (url.pathname.endsWith('/stateIds') && current?.kind === 'poll' && current.config.teamId === '00000000-0000-4000-8000-000000000002') {
        return Response.json({ options: [{ value: '00000000-0000-4000-8000-000000000004', label: 'Ready to review', color: '#4ea7fc' }], version: 1 })
      }
      return Response.json({ options, version: 1 })
    }
    if (url.pathname.endsWith('/presentation'))
      return Response.json({ revision: 2, updatedAt: flow.updatedAt, value: JSON.parse(String(init?.body)).value, version: 1 })
    if (url.pathname.endsWith('/draft/changes')) {
      const body = JSON.parse(String(init?.body)) as { operations: ChangeOperation[] }
      content = applyFlowChanges(content, body.operations)
      sequence++
      log('trigger.saved', content.document.graph.nodes[nodeId])
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
    if (url.pathname.includes('/connections/')) return Response.json({ serviceId, connections: [account], version: 1 })
    throw new Error(`Unsupported Trigger Lab request: ${url.pathname}`)
  })
  const notice = (value: unknown) => log('trigger.notice', value)
  const host = {
    triggerCatalogCache: catalog?.cache,
    openExternalPage: async () => {
      log('trigger.connect')
      return false
    },
  }
  let identity = 0
  const workspace = new WorkspaceStore(client, notice, create ? () => (identity++ === 0 ? nodeId : `${nodeId}-${identity}`) : undefined, i18n)
  const connectors = new ConnectorStore(client, workspace, notice, host, i18n)
  const triggers = new TriggerStore(client, workspace, notice, host, i18n)
  return {
    i18n,
    workspace,
    connectors,
    triggers,
    account,
    async start() {
      await workspace.start(flow.flowId)
      if (create && (trigger.kind == 'poll' || trigger.kind == 'integration')) {
        await workspace.addNode(
          {
            id: `trigger:${trigger.definition.key}`,
            kind: 'trigger',
            label: trigger.name,
            description: trigger.definition.description,
            inputs: [],
            outputs: [],
            trigger: { kind: 'catalog', definition: trigger.definition },
          },
          { x: 0, y: 0 },
        )
        workspace.selectNodes([nodeId])
        await triggers.refresh()
      }
    },
    dispose() {
      triggers.dispose()
      connectors.dispose()
      workspace.dispose()
      i18n.dispose()
    },
  }
}
