import type { ChangeOperation, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { LogAction } from './stories.tsx'

import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { TriggerStore } from '../../src/workbench/browser/runtime/stores/triggerStore.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'
import { setNodePositions } from '../../src/workbench/browser/runtime/workspace.ts'

const target = { kind: 'flow' } as const
// Only transport responses are fixtures; saves use the production Store and Flow reducer.
export function createInspectorSession(language: UiLanguage, log: LogAction, initialContent: RevisionContent) {
  const i18n = createI18n(language)
  const timestamp = '2026-09-14T00:00:00.000Z'
  let sequence = 1
  let content = initialContent

  let presentation = setNodePositions(
    {},
    target,
    Object.fromEntries(Object.keys(initialContent.document.graph.nodes).map((id, index) => [id, { x: 30 + index * 360, y: 40 + index * 40 }])),
  )
  const flow = { flowId: 'inspector-lab', name: 'Properties', draftRevisionId: 'r1', createdAt: timestamp, updatedAt: timestamp, version: 1, status: 'active' }
  const revision = () => ({
    actorId: 'lab',
    createdAt: timestamp,
    digest: `d${sequence}`,
    flowId: flow.flowId,
    modelVersion: 1,
    parentRevisionId: sequence === 1 ? null : `r${sequence - 1}`,
    revisionId: `r${sequence}`,
    version: 1,
  })
  const client = new WorkbenchClient(async (path, init) => {
    const url = new URL(path instanceof Request ? path.url : path, 'https://lab.invalid')
    if (url.pathname === '/v1/flows') return Response.json({ flows: [{ ...flow, draftRevisionId: revision().revisionId }], total: 1, version: 1 })
    if (url.pathname.endsWith('/editor'))
      return Response.json({
        flow: { ...flow, draftRevisionId: revision().revisionId },
        draft: { ...revision(), content },
        presentation: { revision: sequence, updatedAt: timestamp, value: presentation, version: 1 },
        live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        version: 1,
      })
    if (url.pathname.endsWith('/draft/changes')) {
      content = applyFlowChanges(content, (JSON.parse(String(init?.body)) as { operations: ChangeOperation[] }).operations)
      sequence++
      log('inspector.saved', content.document.graph.nodes)
      return Response.json({ revision: revision(), version: 1 })
    }
    if (url.pathname.endsWith('/presentation')) {
      if (init?.method === 'PUT') presentation = JSON.parse(String(init.body)).value
      return Response.json({ revision: sequence, updatedAt: timestamp, value: presentation, version: 1 })
    }
    if (url.pathname.endsWith('/check'))
      return Response.json({
        closureDigest: 'lab',
        diagnostics: [],
        engineContract: 'open-flow-engine/v4',
        flowId: flow.flowId,
        modelVersion: 1,
        revisionDigest: revision().digest,
        revisionId: revision().revisionId,
        valid: true,
        version: 1,
      })
    throw new Error(`Unexpected inspector Lab request: ${url.pathname}`)
  })
  const notice = (value: unknown) => log('inspector.notice', value)
  const store = new WorkspaceStore(client, notice, undefined, i18n)
  const host = { openExternalPage: async () => false }
  const connectors = new ConnectorStore(client, store, notice, host, i18n)
  const triggers = new TriggerStore(client, store, notice, host, i18n)
  return {
    store,
    connectors,
    triggers,
    i18n,
    start: () => store.start(flow.flowId),
    dispose() {
      triggers.dispose()
      connectors.dispose()
      store.dispose()
      i18n.dispose()
    },
  }
}
