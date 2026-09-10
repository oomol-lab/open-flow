import type { ChangeOperation, RevisionContent, TriggerNode } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { LogAction } from './stories.tsx'

import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { TriggerStore } from '../../src/workbench/browser/runtime/stores/triggerStore.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'
import { triggerDraft } from './triggerFixtures.ts'

// Only local HTTP responses are fixtures. Editing and persistence use the production reducer/store.
export function createTriggerSession(trigger: TriggerNode, language: UiLanguage, log: LogAction, nodeId: string) {
  const i18n = createI18n(language)
  const { flow, draft } = triggerDraft(trigger)
  const { content: initialContent, ...revisionMetadata } = draft
  let content: RevisionContent = { ...initialContent, document: { ...initialContent.document, graph: { nodes: { [nodeId]: trigger }, edges: [] } } }
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
    if (url.pathname === '/v1/flows') return Response.json({ flows: [flow], total: 1, version: 1 })
    if (url.pathname.endsWith('/editor'))
      return Response.json({
        flow,
        draft: { ...revision(), content },
        live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        presentation: { revision: 1, updatedAt: flow.updatedAt, value: {}, version: 1 },
        version: 1,
      })
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
    openExternalPage: async () => {
      log('trigger.connect')
      return false
    },
  }
  const workspace = new WorkspaceStore(client, notice, undefined, i18n)
  const connectors = new ConnectorStore(client, workspace, notice, host, i18n)
  const triggers = new TriggerStore(client, workspace, notice, host, i18n)
  return {
    i18n,
    workspace,
    connectors,
    triggers,
    account,
    dispose() {
      triggers.dispose()
      connectors.dispose()
      workspace.dispose()
      i18n.dispose()
    },
  }
}
