import type { JsonValue } from '../../flow/common/change.ts'
import type { WorkflowFile } from '../../flow/common/workflowFile.ts'
import type { ControlClient } from './api.ts'
import type { AuthoringHost, AuthoringRead, AuthoringRequest, AuthoringSearch, AuthoringType } from './authoring.ts'

import { currentFlowModelVersion } from '../../flow/common/changeSchema.ts'
import { canonicalJsonBytes, digestBytes } from '../../flow/common/encoding.ts'
import { validateFlow } from '../../flow/common/semantics.ts'
import { decodeWorkflowFile } from '../../flow/common/workflowFile.ts'
import { currentEngineContract, findEngineContract } from '../../runtime/common/engineContract.ts'
import { workflowCandidate } from '../../workflow/common/workflow.ts'
import { AuthoringError, authoringDiagnostics, compileAuthoring, readAuthoring, searchAuthoring } from './authoring.ts'
import { authoringRequestSchema, authoringSchema, authoringSchemaQuery } from './authoringSchema.ts'

export interface WorkflowAuthoringOptions {
  /** Flow API metadata is already normalized; no Connector catalog adapter runs here. */
  readonly client?: ControlClient
  readonly locale?: string
  readonly engineContract?: string
  /** Override only for callers that own their deterministic node/module identity scope. */
  readonly id?: AuthoringHost['id']
}

async function revision(file: WorkflowFile): Promise<string> {
  return digestBytes(canonicalJsonBytes(JSON.parse(JSON.stringify(file)) as JsonValue))
}

async function checkedRevision(file: WorkflowFile, expected?: string): Promise<string> {
  const actual = await revision(file)
  if (expected != null && expected != actual)
    throw new AuthoringError('flow.revision-conflict', 'The workflow file changed. Read it before submitting another edit.', { revision: actual })
  return actual
}

/** File objects in, file objects out. Persistence and transport belong to the caller. */
export function createWorkflowAuthoring(options: WorkflowAuthoringOptions = {}) {
  function client(): ControlClient {
    if (options.client == null) throw new AuthoringError('catalog.unavailable', 'A Control client is required to discover this capability.')
    return options.client
  }
  const engineContract = options.engineContract ?? currentEngineContract
  const engine = findEngineContract(engineContract)
  if (engine == null) throw new AuthoringError('engine.unsupported', 'The Engine contract is not supported.', { engineContract })

  async function check(file: WorkflowFile) {
    const decoded = decodeWorkflowFile(file)
    const validation = await validateFlow(decoded.content, engine!)
    return {
      revision: await revision(decoded),
      valid: validation.valid,
      diagnostics: authoringDiagnostics(decoded.content, validation.diagnostics),
    }
  }

  return {
    create(metadata: Omit<WorkflowFile, 'kind' | 'version' | 'content'> = {}): WorkflowFile {
      return decodeWorkflowFile({
        ...metadata,
        kind: 'open-flow-workflow',
        version: 1,
        content: { modelVersion: currentFlowModelVersion, document: { graph: { nodes: {}, edges: [] }, bindings: {} }, modules: {} },
      })
    },

    async read(file: WorkflowFile, query: AuthoringRead = {}) {
      const decoded = decodeWorkflowFile(file)
      return { revision: await checkedRevision(decoded, query.revision), data: readAuthoring(decoded.content, query) }
    },

    async search(file: WorkflowFile, query: AuthoringSearch) {
      const decoded = decodeWorkflowFile(file)
      return { revision: await checkedRevision(decoded, query.revision), data: searchAuthoring(decoded.content, query) }
    },

    async schema(query: { readonly type?: AuthoringType; readonly action?: string } = {}) {
      const parsed = authoringSchemaQuery.parse(query)
      if (parsed.action != null) {
        const action = await client().getConnectorActionMetadata(parsed.action, undefined, undefined, options.locale ?? 'en')
        return { action: action.actionId, name: action.name, inputs: action.inputs, outputs: action.outputs, version: 1 as const }
      }
      return { ...authoringSchema(parsed.type), version: 1 as const }
    },

    async edit(file: WorkflowFile, request: AuthoringRequest) {
      const decoded = decodeWorkflowFile(file)
      const parsed = authoringRequestSchema.parse(request)
      const baseRevision = await checkedRevision(decoded, parsed.baseRevision)
      const prefix = (await digestBytes(canonicalJsonBytes([baseRevision, parsed.requestId]))).slice(7, 31)
      const ids = new Map<string, string>()
      const compiled = await compileAuthoring(decoded.content, parsed, {
        id: (label) => {
          if (options.id != null) return options.id(label)
          let id = ids.get(label)
          if (id == null) {
            id = `${prefix}_${ids.size}`
            ids.set(label, id)
          }
          return id
        },
        action: (action) => client().getConnectorActionMetadata(action, undefined, undefined, options.locale ?? 'en'),
        trigger: (key) => client().getTriggerKey(key),
        openapi: (url) => client().loadOpenApiDocument(url),
        workflow: async (flowId) => {
          const candidate = workflowCandidate(await client().getFlow(flowId))
          return candidate.problem == null ? client().getWorkflowContract(flowId) : candidate
        },
      })
      const next = { ...decoded, content: compiled.content }
      const validation = await check(next)
      return {
        file: next,
        revision: validation.revision,
        nodes: compiled.nodes,
        validation: { status: validation.valid ? ('valid' as const) : ('invalid' as const), diagnostics: validation.diagnostics },
      }
    },

    check,
  }
}
