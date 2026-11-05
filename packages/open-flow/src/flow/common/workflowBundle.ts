import type { WorkflowFile } from './workflowFile.ts'

import { z } from 'zod'
import { checkJsonDepth } from './json.ts'
import { cleanWorkflowFile, decodeWorkflowFile } from './workflowFile.ts'
import { mapNodeWorkflowTargets, nodeWorkflowReferences } from './workflowReferences.ts'

export interface WorkflowBundleEntry {
  readonly flowId: string
  readonly file: WorkflowFile
}

export interface WorkflowBundle {
  readonly kind: 'open-flow-workflow-bundle'
  readonly version: 1
  readonly entryFlowId: string
  readonly workflows: readonly WorkflowBundleEntry[]
}

/** A saved export snapshot; unavailable targets carry no account metadata. */
export interface WorkflowExportPreview {
  readonly version: 1
  readonly entryFlowId: string
  readonly workflows: readonly WorkflowBundleEntry[]
  readonly unavailableFlowIds: readonly string[]
}

const entries = z.array(z.strictObject({ flowId: z.string().min(1), file: z.unknown() })).min(1)
const bundleSchema = z.strictObject({ kind: z.literal('open-flow-workflow-bundle'), version: z.literal(1), entryFlowId: z.string().min(1), workflows: entries })
const previewSchema = z.strictObject({
  version: z.literal(1),
  entryFlowId: z.string().min(1),
  workflows: entries,
  unavailableFlowIds: z.array(z.string().min(1)),
})

function decodeEntries(value: z.infer<typeof entries>, entryFlowId: string, unavailableFlowIds: readonly string[] = []): readonly WorkflowBundleEntry[] {
  const workflows = value.map(({ flowId, file }) => ({ flowId, file: decodeWorkflowFile(file) }))
  const ids = new Set(workflows.map(({ flowId }) => flowId))
  if (ids.size != workflows.length || !ids.has(entryFlowId)) throw new TypeError('Workflow identities must be unique and include the entry workflow.')
  const unavailable = new Set(unavailableFlowIds)
  if (unavailable.size != unavailableFlowIds.length || unavailableFlowIds.some((id) => ids.has(id)))
    throw new TypeError('Invalid unavailable workflow identities.')
  for (const { file } of workflows)
    for (const node of Object.values(file.content.document.graph.nodes))
      for (const { target } of nodeWorkflowReferences(node))
        if (target.flowId && !ids.has(target.flowId) && !unavailable.has(target.flowId))
          throw new TypeError('A referenced workflow is missing from the bundle.')
  return workflows
}

export function decodeWorkflowBundle(value: unknown): WorkflowBundle {
  checkJsonDepth(value, -4)
  const bundle = bundleSchema.parse(value)
  return { ...bundle, workflows: decodeEntries(bundle.workflows, bundle.entryFlowId) }
}

export function decodeWorkflowExportPreview(value: unknown): WorkflowExportPreview {
  checkJsonDepth(value, -4)
  const preview = previewSchema.parse(value)
  return { ...preview, workflows: decodeEntries(preview.workflows, preview.entryFlowId, preview.unavailableFlowIds) }
}

export function cleanWorkflowBundle(value: unknown): WorkflowBundle {
  const bundle = decodeWorkflowBundle(value)
  return { ...bundle, workflows: bundle.workflows.map(({ flowId, file }) => ({ flowId, file: cleanWorkflowFile(file).file })) }
}

export function workflowBundleFromPreview(preview: WorkflowExportPreview): WorkflowBundle {
  if (preview.unavailableFlowIds.length) throw new TypeError('Some referenced workflows are unavailable.')
  return cleanWorkflowBundle({ kind: 'open-flow-workflow-bundle', version: 1, entryFlowId: preview.entryFlowId, workflows: preview.workflows })
}

export function encodeWorkflowBundle(bundle: WorkflowBundle): string {
  return `${JSON.stringify(cleanWorkflowBundle(bundle), null, 2)}\n`
}

export type WorkflowImportFile = WorkflowFile | WorkflowBundle

export function parseWorkflowImportFile(text: string): WorkflowImportFile {
  const value: unknown = JSON.parse(text)
  return value != null && typeof value == 'object' && 'kind' in value && value.kind == 'open-flow-workflow-bundle'
    ? decodeWorkflowBundle(value)
    : decodeWorkflowFile(value)
}

/** A bundle creates new drafts, so old published interface provenance must be refreshed. */
export function remapWorkflowBundle(bundle: WorkflowBundle, flowIds: ReadonlyMap<string, string>): WorkflowBundle {
  const cleaned = cleanWorkflowBundle(bundle)
  function identity(flowId: string): string {
    const mapped = flowIds.get(flowId)
    if (mapped == null || mapped.length == 0) throw new TypeError('Missing imported workflow identity.')
    return mapped
  }
  const workflows = cleaned.workflows.map(({ flowId, file }) => ({
    flowId: identity(flowId),
    file: {
      ...file,
      content: {
        ...file.content,
        document: {
          ...file.content.document,
          graph: {
            ...file.content.document.graph,
            nodes: Object.fromEntries(
              Object.entries(file.content.document.graph.nodes).map(([id, node]) => [
                id,
                mapNodeWorkflowTargets(node, (target) => ({ flowId: target.flowId ? identity(target.flowId) : '', revisionId: '' })),
              ]),
            ),
          },
        },
      },
    },
  }))
  return decodeWorkflowBundle({ ...cleaned, entryFlowId: identity(cleaned.entryFlowId), workflows })
}
