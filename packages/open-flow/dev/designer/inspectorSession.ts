import type { ConnectorAccess, ConnectorActionMetadata } from '../../src/control/common/api.ts'
import type { ChangeOperation, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { applyFlowChanges } from '../../src/flow/common/change.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { setNodePositions } from '../../src/workbench/browser/runtime/canvasPresentation.ts'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { ConnectorStore } from '../../src/workbench/browser/runtime/stores/connectorStore.ts'
import { TriggerStore } from '../../src/workbench/browser/runtime/stores/triggerStore.ts'
import { WorkspaceStore } from '../../src/workbench/browser/runtime/stores/workspaceStore.ts'

const target = { kind: 'flow' } as const
// Only transport responses are fixtures; saves use the production Store and Flow reducer.
export function createInspectorTransport(
  log: LogAction,
  initialContent: RevisionContent,
  options: {
    readonly access?: ConnectorAccess
    readonly accessError?: boolean
    readonly accessSaveDelay?: number
    readonly actions?: readonly ConnectorActionMetadata[]
    readonly candidates?: readonly {
      readonly accessBindingId: string
      readonly connectionDisplayName: string
      readonly permissionGroupName?: string | null
      readonly providerId: string
    }[]
    readonly connections?: readonly {
      readonly displayName: string
      readonly id: string
      readonly isDefault: boolean
      readonly service: string
      readonly status: 'active' | 'disconnected' | 'error' | 'reauth_required'
    }[]
    readonly providers?: readonly { readonly authTypes: readonly string[]; readonly displayName: string; readonly service: string }[]
  } = {},
) {
  const timestamp = '2026-09-14T00:00:00.000Z'
  let sequence = 1
  let content = initialContent
  let access = options.access ?? { accessRevision: 0, bindings: [], mode: 'implicit', providerAccessDigest: 'implicit:lab', version: 1 }

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
    modelVersion: currentFlowModelVersion,
    parentRevisionId: sequence === 1 ? null : `r${sequence - 1}`,
    revisionId: `r${sequence}`,
    version: 1,
  })
  const client = new WorkbenchClient(async (path, init) => {
    const url = new URL(path instanceof Request ? path.url : path, 'https://lab.invalid')
    if (url.pathname.endsWith('/connector-access')) {
      if (options.accessError) return Response.json({ error: { code: 'connector.unavailable', message: 'Unavailable.' }, version: 1 }, { status: 503 })
      return Response.json(access)
    }
    const service = /\/connector-access\/([^/]+)\/service$/.exec(url.pathname)
    if (service != null && (init?.method == 'PUT' || init?.method == 'DELETE')) {
      const providerId = decodeURIComponent(service[1]!)
      access = {
        ...access,
        accessRevision: access.accessRevision + 1,
        providerIds:
          init.method == 'PUT' ? [...new Set([...(access.providerIds ?? []), providerId])] : (access.providerIds ?? []).filter((id) => id != providerId),
        bindings: init.method == 'PUT' ? access.bindings : access.bindings.filter((binding) => binding.providerId != providerId),
      }
      return Response.json(access)
    }
    const candidate = /\/connector-access\/([^/]+)\/candidates$/.exec(url.pathname)
    if (candidate != null)
      return Response.json({
        candidates: (options.candidates ?? []).filter((item) => item.providerId == decodeURIComponent(candidate[1]!)),
        mode: access.mode,
        providerId: decodeURIComponent(candidate[1]!),
        version: 1,
      })
    const mutation = /\/connector-access\/([^/]+)$/.exec(url.pathname)
    if (mutation != null && (init?.method == 'PUT' || init?.method == 'DELETE')) {
      if (options.accessSaveDelay) await new Promise((resolve) => setTimeout(resolve, options.accessSaveDelay))
      const providerId = decodeURIComponent(mutation[1]!)
      const input = JSON.parse(String(init.body)) as { readonly accessBindingId?: string }
      const selected = options.candidates?.find((item) => item.providerId == providerId && item.accessBindingId == input.accessBindingId)
      access = {
        ...access,
        accessRevision: access.accessRevision + 1,
        bindings:
          init.method == 'DELETE'
            ? access.bindings.filter((binding) => binding.providerId != providerId || binding.accessBindingId != input.accessBindingId)
            : [
                ...access.bindings.filter((binding) => binding.providerId != providerId || binding.accessBindingId != input.accessBindingId),
                {
                  connectionId: 'fixture-account',
                  source: { kind: 'policy' as const, ruleId: null },
                  accessBindingId: selected!.accessBindingId,
                  connectionDisplayName: selected!.connectionDisplayName,
                  ...(selected!.permissionGroupName === undefined ? {} : { permissionGroupName: selected!.permissionGroupName }),
                  providerId,
                  status: 'active',
                },
              ],
        providerAccessDigest: `selectable:lab:${access.accessRevision + 1}`,
      }
      return Response.json(access)
    }
    if (url.pathname.endsWith('/connector/proxy/providers')) return Response.json({ success: true, data: options.providers ?? [] })
    if (url.pathname.endsWith('/connector/action-metadata')) {
      const query = (url.searchParams.get('q') ?? '').toLowerCase()
      return Response.json({
        actions: (options.actions ?? []).filter((action) => `${action.serviceName} ${action.name} ${action.description}`.toLowerCase().includes(query)),
        version: 1,
      })
    }
    if (url.pathname.endsWith('/connector/proxy/actions'))
      return Response.json({
        success: true,
        data: (options.actions ?? [])
          .filter((action) => action.serviceId == url.searchParams.get('service'))
          .map((action) => ({
            id: action.actionId,
            service: action.serviceId,
            name: action.name,
            description: action.description,
            inputSchema: action.inputSchema,
            outputSchema: action.outputSchema,
          })),
      })
    if (url.pathname.endsWith('/connector/proxy/apps')) return Response.json({ success: true, data: options.connections ?? [] })
    if (url.pathname === '/v1/trigger-keys/catalog')
      return Response.json({ version: 2, locale: url.searchParams.get('locale') ?? 'en', definitions: [], display: {} })
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
        engineContract: 'open-flow-engine/v5',
        flowId: flow.flowId,
        modelVersion: currentFlowModelVersion,
        revisionDigest: revision().digest,
        revisionId: revision().revisionId,
        valid: true,
        version: 1,
      })
    throw new Error(`Unexpected inspector Lab request: ${url.pathname}`)
  })
  return { client, flowId: flow.flowId }
}

export function createInspectorSession(language: UiLanguage, log: LogAction, initialContent: RevisionContent) {
  const { client, flowId } = createInspectorTransport(log, initialContent)
  const i18n = createI18n(language)
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
    start: () => store.start(flowId),
    dispose() {
      triggers.dispose()
      connectors.dispose()
      store.dispose()
      i18n.dispose()
    },
  }
}
