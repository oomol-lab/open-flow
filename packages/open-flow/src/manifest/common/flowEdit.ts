import type { HandleInputFrom, HandleName, NodeId, TriggerDefinitionSnapshot } from '../../schema/index.ts'
import type { WritableNodeManifest } from './writable/node/writableNodeManifest.ts'

import { dequal } from 'dequal/lite'
import { z } from 'zod'
import { isJsonValue } from '../../base/common/json.ts'
import { FlowNodeSchema, FlowSchema, HandleNameSchema, NodeIdSchema, TriggerDefinitionSnapshotSchema } from '../../schema/index.ts'
import { WritableConditionNodeManifest } from './writable/node/writableConditionNodeManifest.ts'
import { WritableSubflowNodeManifest } from './writable/node/writableSubflowNodeManifest.ts'
import { WritableTaskNodeManifest } from './writable/node/writableTaskNodeManifest.ts'
import { WritableTriggerNodeManifest } from './writable/node/writableTriggerNodeManifest.ts'
import { WritableValueNodeManifest } from './writable/node/writableValueNodeManifest.ts'
import { WritableFlowManifest } from './writable/writableFlowManifest.ts'
import { getYamlNode, isYamlMap, parseYamlDoc, stringify, TO_STRING_OPTIONS } from './yaml.ts'

const connectionSchema = z.strictObject({
  from: z.strictObject({
    nodeId: NodeIdSchema,
    handle: HandleNameSchema,
  }),
  to: z.strictObject({
    nodeId: NodeIdSchema,
    handle: HandleNameSchema,
  }),
})

export const FlowEditOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('add-trigger-definition'), snapshot: TriggerDefinitionSnapshotSchema }),
  z.strictObject({
    type: z.literal('remove-trigger-definition'),
    triggerType: z.string().min(1),
    revision: z.string().min(1),
  }),
  z.strictObject({ type: z.literal('add-node'), node: FlowNodeSchema }),
  z.strictObject({ type: z.literal('replace-node'), node: FlowNodeSchema }),
  z.strictObject({ type: z.literal('remove-node'), nodeId: NodeIdSchema }),
  z.strictObject({ type: z.literal('connect'), connection: connectionSchema }),
  z.strictObject({ type: z.literal('disconnect'), connection: connectionSchema }),
])

export const FlowEditOperationsSchema = z
  .array(FlowEditOperationSchema)
  .min(1)
  .superRefine((operations, context) => {
    for (const [index, operation] of operations.entries()) {
      if (!isJsonValue(operation)) {
        context.addIssue({
          code: 'custom',
          message: 'Expected a JSON-safe operation.',
          path: [index],
        })
      }
    }
  })

export type FlowEditOperation = z.input<typeof FlowEditOperationSchema>

export interface FlowEditIssue {
  readonly code: string
  readonly message: string
  readonly path: string
}

export class FlowEditError extends Error {
  public readonly issues: readonly FlowEditIssue[]

  public constructor(issues: readonly FlowEditIssue[]) {
    super(issues.map((issue) => issue.message).join(' '))
    this.name = 'FlowEditError'
    this.issues = issues
  }
}

export interface PlannedFlowEdit {
  readonly flow: z.infer<typeof FlowSchema>
  readonly source: string
}

export function planFlowEdit(source: string, operations: readonly FlowEditOperation[]): PlannedFlowEdit {
  const parsed = FlowEditOperationsSchema.safeParse(operations)
  if (!parsed.success) {
    throw new FlowEditError(
      parsed.error.issues.map((issue) => ({
        code: 'operation.invalid',
        message: issue.message,
        path: pointer(['operations', ...issue.path]),
      })),
    )
  }

  const manifest = new WritableFlowManifest(source)
  try {
    applyFlowEditOperations(manifest, parsed.data)

    const flow = FlowSchema.safeParse(manifest.toJSON())
    if (!flow.success) {
      throw new FlowEditError(
        flow.error.issues.map((issue) => ({
          code: 'flow.invalid',
          message: issue.message,
          path: pointer(issue.path),
        })),
      )
    }
    return { flow: flow.data, source: manifest.yamlParent.toString(TO_STRING_OPTIONS) }
  } finally {
    manifest.dispose()
  }
}

export function applyFlowEditOperations(manifest: WritableFlowManifest, operations: readonly FlowEditOperation[]): void {
  for (const [index, operation] of operations.entries()) applyOperation(manifest, operation, index)
}

function applyOperation(manifest: WritableFlowManifest, operation: FlowEditOperation, index: number): void {
  const operationPath = pointer(['operations', index])
  switch (operation.type) {
    case 'add-trigger-definition': {
      const snapshots = manifest.$$.trigger_definitions.value ?? []
      const existing = snapshots.find((snapshot) => sameTriggerIdentity(snapshot, operation.snapshot))
      if (existing != null) {
        if (!sameTriggerSemantics(existing, operation.snapshot)) {
          fail(
            'trigger-definition.conflict',
            `Trigger definition "${operation.snapshot.type}" revision "${operation.snapshot.revision}" conflicts with the existing snapshot.`,
            operationPath,
          )
        }
        if (!dequal(existing, operation.snapshot)) {
          manifest.$$.trigger_definitions.set(snapshots.map((snapshot) => (sameTriggerIdentity(snapshot, operation.snapshot) ? operation.snapshot : snapshot)))
        }
        return
      }
      manifest.$$.trigger_definitions.set(
        [...snapshots, operation.snapshot].toSorted((left, right) => compareText(left.type, right.type) || compareText(left.revision, right.revision)),
      )
      return
    }
    case 'remove-trigger-definition': {
      const referenced = [...manifest.nodeManifests.values()].some((node) => {
        const trigger = WritableTriggerNodeManifest.to(node)?.$.trigger.value
        return trigger?.type == operation.triggerType && trigger.revision == operation.revision
      })
      if (referenced) {
        fail(
          'trigger-definition.referenced',
          `Trigger definition "${operation.triggerType}" revision "${operation.revision}" is still referenced.`,
          operationPath,
        )
      }
      const snapshots = manifest.$$.trigger_definitions.value ?? []
      const remaining = snapshots.filter((snapshot) => snapshot.type != operation.triggerType || snapshot.revision != operation.revision)
      manifest.$$.trigger_definitions.set(remaining.length == 0 ? undefined : remaining)
      return
    }
    case 'add-node': {
      const nodeId = operation.node.node_id as NodeId
      if (manifest.nodeManifests.has(nodeId)) fail('node.already-exists', `Node "${nodeId}" already exists.`, operationPath)
      manifest.nodeManifests.set(nodeId, createNode(operation.node))
      return
    }
    case 'replace-node': {
      const nodeId = operation.node.node_id as NodeId
      if (!manifest.nodeManifests.has(nodeId)) fail('node.not-found', `Node "${nodeId}" does not exist.`, operationPath)
      manifest.nodeManifests.set(nodeId, createNode(operation.node))
      return
    }
    case 'remove-node': {
      const nodeId = operation.nodeId as NodeId
      if (!manifest.nodeManifests.has(nodeId)) fail('node.not-found', `Node "${nodeId}" does not exist.`, operationPath)
      const reference = findReference(manifest, nodeId)
      if (reference) {
        fail(
          'node.referenced',
          `Node "${nodeId}" is still connected to "${reference.nodeId}" input "${reference.handle}". Disconnect it before removing the node.`,
          operationPath,
        )
      }
      manifest.nodeManifests.delete(nodeId)
      return
    }
    case 'connect':
      connect(manifest, operation.connection, operationPath)
      return
    case 'disconnect':
      disconnect(manifest, operation.connection, operationPath)
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameTriggerIdentity(left: TriggerDefinitionSnapshot, right: TriggerDefinitionSnapshot): boolean {
  return left.type == right.type && left.revision == right.revision
}

function sameTriggerSemantics(left: TriggerDefinitionSnapshot, right: TriggerDefinitionSnapshot): boolean {
  return (
    sameTriggerIdentity(left, right) &&
    left.definition.service_id == right.definition.service_id &&
    dequal(left.definition.provisioning, right.definition.provisioning) &&
    dequal(left.definition.connector, right.definition.connector) &&
    dequal(left.definition.config_inputs, right.definition.config_inputs) &&
    dequal(left.definition.outputs, right.definition.outputs)
  )
}

function createNode(node: z.input<typeof FlowNodeSchema>): WritableNodeManifest {
  const doc = parseYamlDoc(stringify({ node }))
  const yamlParent = getYamlNode(doc, 'node').filter(isYamlMap).unwrap()
  const nodeId = node.node_id as NodeId
  if ('trigger' in node) return new WritableTriggerNodeManifest(nodeId, yamlParent)
  if ('subflow' in node) return new WritableSubflowNodeManifest(nodeId, yamlParent)
  if ('values' in node) return new WritableValueNodeManifest(nodeId, yamlParent)
  if ('conditions' in node) return new WritableConditionNodeManifest(nodeId, yamlParent)
  return new WritableTaskNodeManifest(nodeId, yamlParent)
}

function connect(manifest: WritableFlowManifest, connection: z.infer<typeof connectionSchema>, operationPath: string): void {
  const sourceId = connection.from.nodeId as NodeId
  const targetId = connection.to.nodeId as NodeId
  const sourceNode = manifest.nodeManifests.get(sourceId)
  if (!sourceNode) fail('node.not-found', `Source node "${sourceId}" does not exist.`, operationPath)
  const target = manifest.nodeManifests.get(targetId)
  if (!target) fail('node.not-found', `Target node "${targetId}" does not exist.`, operationPath)
  if (WritableTriggerNodeManifest.is(sourceNode)) {
    const identity = sourceNode.$.trigger.value
    const definition = manifest.$.trigger_definitions.value?.find(
      (snapshot) => snapshot.type === identity?.type && snapshot.revision === identity?.revision,
    )?.definition
    if (!definition?.outputs.some((port) => port.handle === connection.from.handle))
      fail('connection.invalid-source-handle', `Trigger "${sourceId}" does not declare output "${connection.from.handle}".`, operationPath)
  }
  if (WritableTriggerNodeManifest.is(target)) {
    fail('connection.invalid-target', `Trigger "${targetId}" does not accept input connections.`, operationPath)
  }

  const inputs = target.$$.inputs_from.value?.slice() ?? []
  const inputIndex = inputs.findIndex((input) => input.handle == connection.to.handle)
  const input: HandleInputFrom = inputIndex < 0 ? { handle: connection.to.handle as HandleName } : inputs[inputIndex]!
  const sources = input.from_node?.slice() ?? []
  if (sources.some((source) => source.node_id == sourceId && source.output_handle == connection.from.handle)) {
    fail('connection.already-exists', 'The connection already exists.', operationPath)
  }
  const { value: _removed, ...rest } = input
  const next: HandleInputFrom = {
    ...rest,
    from_node: [...sources, { node_id: sourceId, output_handle: connection.from.handle as HandleName }],
  }
  target.$$.inputs_from.set(inputIndex < 0 ? [...inputs, next] : inputs.toSpliced(inputIndex, 1, next))
}

function disconnect(manifest: WritableFlowManifest, connection: z.infer<typeof connectionSchema>, operationPath: string): void {
  const sourceId = connection.from.nodeId as NodeId
  const targetId = connection.to.nodeId as NodeId
  if (!manifest.nodeManifests.has(sourceId)) fail('node.not-found', `Source node "${sourceId}" does not exist.`, operationPath)
  const target = manifest.nodeManifests.get(targetId)
  if (!target) fail('node.not-found', `Target node "${targetId}" does not exist.`, operationPath)

  const inputs = target.$$.inputs_from.value?.slice() ?? []
  const inputIndex = inputs.findIndex((input) => input.handle == connection.to.handle)
  const input = inputs[inputIndex]
  const sourceIndex = input?.from_node?.findIndex((source) => source.node_id == sourceId && source.output_handle == connection.from.handle)
  if (input == null || sourceIndex == null || sourceIndex < 0) {
    fail('connection.not-found', 'The connection does not exist.', operationPath)
  }

  const sources = input.from_node!.toSpliced(sourceIndex, 1)
  const { from_node: _removed, ...rest } = input
  const next = sources.length == 0 ? rest : { ...rest, from_node: sources }
  const replacement =
    sources.length == 0 && next.value === undefined && !next.from_flow?.length && !next.schema_overrides?.length
      ? inputs.toSpliced(inputIndex, 1)
      : inputs.toSpliced(inputIndex, 1, next)
  target.$$.inputs_from.set(replacement.length == 0 ? undefined : replacement)
}

function findReference(manifest: WritableFlowManifest, sourceId: NodeId): { readonly handle: string; readonly nodeId: NodeId } | undefined {
  for (const [nodeId, node] of manifest.nodeManifests) {
    for (const input of node.$$.inputs_from.value ?? []) {
      if (input.from_node?.some((source) => source.node_id == sourceId)) return { handle: input.handle, nodeId }
    }
  }
}

function fail(code: string, message: string, path: string): never {
  throw new FlowEditError([{ code, message, path }])
}

function pointer(path: readonly PropertyKey[]): string {
  return `#/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}
