import type {
  ChangeOperation,
  ConnectorCapability,
  InputPortDefinition,
  JsonValue,
  ManagedTaskDefinition,
  PortDefinition,
  TriggerSchedule,
} from '@oomol-lab/open-flow/flow-change'

import { decodeChangeOperations, decodeConnectorCapabilities } from '@oomol-lab/open-flow/flow-change'
import { CliError, triggerSchedule } from './support.ts'

type ApplyNode =
  | {
      readonly action: string
      readonly connection?: string
      readonly inputs: Readonly<Record<string, JsonValue>>
      readonly kind: 'connector'
      readonly name?: string
    }
  | {
      readonly capabilities?: readonly ConnectorCapability[]
      readonly code: string
      readonly inputs?: Readonly<Record<string, InputPortDefinition>>
      readonly kind: 'code'
      readonly name: string
      readonly outputs?: Readonly<Record<string, PortDefinition>>
    }
  | {
      readonly inputs?: Readonly<Record<string, JsonValue>>
      readonly kind: 'llm-chat' | 'llm-json'
      readonly name: string
      readonly output?: PortDefinition
    }
  | { readonly kind: 'agent'; readonly task: ManagedTaskDefinition }
  | { readonly kind: 'condition' | 'value'; readonly name: string }

interface ApplyEdge {
  readonly sourceHandle?: string
  readonly source: string
  readonly target: string
}

type ApplyTrigger =
  | { readonly kind: 'manual'; readonly name?: string }
  | { readonly kind: 'webhook'; readonly name?: string }
  | { readonly kind: 'cron'; readonly name?: string; readonly schedule?: readonly TriggerSchedule[] }
  | {
      readonly config: Readonly<Record<string, JsonValue>>
      readonly connection?: string
      readonly key: string
      readonly kind: 'provider'
      readonly name?: string
      readonly schedule?: readonly TriggerSchedule[]
    }

interface ApplySpec {
  readonly operations?: readonly ChangeOperation[]
  readonly edges: readonly ApplyEdge[]
  readonly nodes: Readonly<Record<string, ApplyNode>>
  readonly triggers: Readonly<Record<string, ApplyTrigger>>
  readonly version: 1
}

function applyObject(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new CliError('flow.apply-invalid', message)
  return value as Readonly<Record<string, unknown>>
}

function applyString(value: unknown, field: string): string {
  if (typeof value != 'string' || value.trim().length == 0) {
    throw new CliError('flow.apply-invalid', `${field} must be a non-empty string.`)
  }
  return value
}

function applyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], field: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new CliError('flow.apply-invalid', `${field} contains unknown fields: ${unexpected.join(', ')}.`)
}

function applyTriggerSchedule(trigger: Readonly<Record<string, unknown>>, reference: string): readonly TriggerSchedule[] | undefined {
  const cron = trigger.cron == null ? undefined : applyString(trigger.cron, `triggers.${reference}.cron`)
  const every = trigger.every == null ? undefined : applyString(trigger.every, `triggers.${reference}.every`)
  const timezone = trigger.timezone == null ? undefined : applyString(trigger.timezone, `triggers.${reference}.timezone`)
  return triggerSchedule(every, cron, timezone)
}

function applyPortDefinitions(value: unknown, field: string, input: boolean): Readonly<Record<string, InputPortDefinition | PortDefinition>> {
  const candidates = applyObject(value, `${field} must be an object keyed by port handle.`)
  return Object.fromEntries(
    Object.entries(candidates).map(([handle, candidate]) => {
      if (handle.trim().length == 0) throw new CliError('flow.apply-invalid', `${field} port handles cannot be empty.`)
      const port = applyObject(candidate, `${field}.${handle} must be an object.`)
      applyKeys(port, input ? ['description', 'jsonSchema', 'nullable', 'value'] : ['description', 'jsonSchema', 'nullable'], `${field}.${handle}`)
      if (!Object.hasOwn(port, 'jsonSchema')) throw new CliError('flow.apply-invalid', `${field}.${handle}.jsonSchema is required.`)
      const jsonSchema =
        typeof port.jsonSchema == 'boolean'
          ? port.jsonSchema
          : (applyObject(port.jsonSchema, `${field}.${handle}.jsonSchema must be an object or boolean.`) as JsonValue)
      if (typeof port.nullable != 'boolean') throw new CliError('flow.apply-invalid', `${field}.${handle}.nullable must be a boolean.`)
      return [
        handle,
        {
          ...(port.description == null ? {} : { description: applyString(port.description, `${field}.${handle}.description`) }),
          jsonSchema,
          nullable: port.nullable,
          ...(input && Object.hasOwn(port, 'value') ? { value: port.value as JsonValue } : {}),
        },
      ]
    }),
  )
}

function applyLlmInputs(value: unknown, field: string): Readonly<Record<string, JsonValue>> {
  const inputs = applyObject(value, `${field} must be an object.`)
  applyKeys(inputs, ['input', 'messages', 'model', 'template'], field)
  return Object.fromEntries(Object.entries(inputs).map(([handle, candidate]) => [handle, applyLlmInput(candidate, `${field}.${handle}`, handle)]))
}

function applyLlmInput(value: unknown, field: string, handle: string): JsonValue {
  switch (handle) {
    case 'input':
      if (typeof value != 'string') throw new CliError('flow.apply-invalid', `${field} must be a string.`)
      return value
    case 'messages':
      if (value == null) return null
      return applyObjectArray(value, field, false)
    case 'model':
      return applyObject(value, `${field} must be an object.`) as JsonValue
    case 'template':
      return applyObjectArray(value, field, true)
    default:
      throw new CliError('flow.apply-invalid', `${field} is not a supported LLM input.`)
  }
}

function applyObjectArray(value: unknown, field: string, nonEmpty: boolean): readonly JsonValue[] {
  if (!Array.isArray(value) || (nonEmpty && value.length == 0) || value.some((item) => item == null || typeof item != 'object' || Array.isArray(item))) {
    throw new CliError('flow.apply-invalid', `${field} must be ${nonEmpty ? 'a non-empty' : 'an'} array of objects.`)
  }
  return value as readonly JsonValue[]
}

export function applySpec(source: string): ApplySpec {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new CliError('flow.apply-invalid', 'Flow apply input must be valid JSON.')
  }
  const root = applyObject(parsed, 'Flow apply input must be an object.')
  if (Object.hasOwn(root, 'operations')) {
    applyKeys(root, ['version', 'operations'], 'Flow apply input')
    if (root.version != 1) throw new CliError('flow.apply-invalid', 'Flow apply version must be 1.')
    try {
      return { version: 1, nodes: {}, triggers: {}, edges: [], operations: decodeChangeOperations(root.operations) }
    } catch (error) {
      throw new CliError('flow.apply-invalid', error instanceof Error ? error.message : String(error))
    }
  }
  applyKeys(root, ['edges', 'nodes', 'triggers', 'version'], 'Flow apply input')
  if (root.version !== 1) throw new CliError('flow.apply-invalid', 'Flow apply input version must be 1.')

  const nodeValues = root.nodes == null ? {} : applyObject(root.nodes, 'Flow apply nodes must be an object keyed by local reference.')
  const nodes = Object.fromEntries(
    Object.entries(nodeValues).map(([reference, candidate]) => {
      if (reference.trim().length == 0) throw new CliError('flow.apply-invalid', 'Flow apply node references cannot be empty.')
      const node = applyObject(candidate, `Flow apply node ${JSON.stringify(reference)} must be an object.`)
      const kind = applyString(node.kind, `nodes.${reference}.kind`)
      switch (kind) {
        case 'connector': {
          applyKeys(node, ['action', 'connection', 'inputs', 'kind', 'name'], `nodes.${reference}`)
          const inputs = node.inputs == null ? {} : applyObject(node.inputs, `nodes.${reference}.inputs must be an object.`)
          return [
            reference,
            {
              action: applyString(node.action, `nodes.${reference}.action`),
              ...(node.connection == null ? {} : { connection: applyString(node.connection, `nodes.${reference}.connection`) }),
              inputs: inputs as Readonly<Record<string, JsonValue>>,
              kind,
              ...(node.name == null ? {} : { name: applyString(node.name, `nodes.${reference}.name`) }),
            },
          ] as const
        }
        case 'code': {
          applyKeys(node, ['capabilities', 'code', 'inputs', 'kind', 'name', 'outputs'], `nodes.${reference}`)
          let capabilities: readonly ConnectorCapability[] | undefined
          if (Object.hasOwn(node, 'capabilities')) {
            try {
              capabilities = decodeConnectorCapabilities(node.capabilities)
            } catch (error) {
              throw new CliError('flow.apply-invalid', `nodes.${reference}.capabilities: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
          return [
            reference,
            {
              ...(capabilities == null ? {} : { capabilities }),
              code: applyString(node.code, `nodes.${reference}.code`),
              ...(node.inputs == null ? {} : { inputs: applyPortDefinitions(node.inputs, `nodes.${reference}.inputs`, true) }),
              kind,
              name: applyString(node.name, `nodes.${reference}.name`),
              ...(node.outputs == null ? {} : { outputs: applyPortDefinitions(node.outputs, `nodes.${reference}.outputs`, false) }),
            },
          ] as const
        }
        case 'agent': {
          applyKeys(node, ['kind', 'task'], `nodes.${reference}`)
          let operation
          try {
            ;[operation] = decodeChangeOperations([{ kind: 'task.create', taskId: reference, task: node.task }])
          } catch (error) {
            throw new CliError('flow.apply-invalid', `nodes.${reference}.task: ${error instanceof Error ? error.message : String(error)}`)
          }
          if (operation?.kind != 'task.create' || operation.task.executor.kind != 'agent')
            throw new CliError('flow.apply-invalid', 'Agent configuration is required.')
          return [reference, { kind, task: operation.task }] as const
        }
        case 'llm-chat':
        case 'llm-json': {
          applyKeys(node, ['inputs', 'kind', 'name', 'outputs'], `nodes.${reference}`)
          const outputs = node.outputs == null ? undefined : applyPortDefinitions(node.outputs, `nodes.${reference}.outputs`, false)
          if (outputs != null) applyKeys(outputs, ['output'], `nodes.${reference}.outputs`)
          return [
            reference,
            {
              ...(node.inputs == null ? {} : { inputs: applyLlmInputs(node.inputs, `nodes.${reference}.inputs`) }),
              kind,
              name: applyString(node.name, `nodes.${reference}.name`),
              ...(outputs?.output == null ? {} : { output: outputs.output }),
            },
          ] as const
        }
        case 'condition':
        case 'value':
          applyKeys(node, ['kind', 'name'], `nodes.${reference}`)
          return [reference, { kind, name: applyString(node.name, `nodes.${reference}.name`) }] as const
        default:
          throw new CliError('flow.apply-invalid', `Unknown Flow apply node kind ${JSON.stringify(kind)}.`)
      }
    }),
  )

  const triggerValues = root.triggers == null ? {} : applyObject(root.triggers, 'Flow apply triggers must be an object keyed by local reference.')
  const triggers = Object.fromEntries(
    Object.entries(triggerValues).map(([reference, candidate]) => {
      if (reference.trim().length == 0) throw new CliError('flow.apply-invalid', 'Flow apply trigger references cannot be empty.')
      const trigger = applyObject(candidate, `Flow apply trigger ${JSON.stringify(reference)} must be an object.`)
      const kind = applyString(trigger.kind, `triggers.${reference}.kind`)
      const name = trigger.name == null ? undefined : applyString(trigger.name, `triggers.${reference}.name`)
      switch (kind) {
        case 'manual':
        case 'webhook':
          applyKeys(trigger, ['kind', 'name'], `triggers.${reference}`)
          return [reference, { kind, ...(name == null ? {} : { name }) }] as const
        case 'cron': {
          applyKeys(trigger, ['cron', 'every', 'kind', 'name', 'timezone'], `triggers.${reference}`)
          const schedule = applyTriggerSchedule(trigger, reference)
          return [reference, { kind, ...(name == null ? {} : { name }), ...(schedule == null ? {} : { schedule }) }] as const
        }
        case 'provider': {
          applyKeys(trigger, ['config', 'connection', 'cron', 'every', 'key', 'kind', 'name', 'timezone'], `triggers.${reference}`)
          const config = trigger.config == null ? {} : applyObject(trigger.config, `triggers.${reference}.config must be an object.`)
          const connection = trigger.connection == null ? undefined : applyString(trigger.connection, `triggers.${reference}.connection`)
          const schedule = applyTriggerSchedule(trigger, reference)
          return [
            reference,
            {
              config: config as Readonly<Record<string, JsonValue>>,
              ...(connection == null ? {} : { connection }),
              key: applyString(trigger.key, `triggers.${reference}.key`),
              kind,
              ...(name == null ? {} : { name }),
              ...(schedule == null ? {} : { schedule }),
            },
          ] as const
        }
        default:
          throw new CliError('flow.apply-invalid', `Unknown Flow apply trigger kind ${JSON.stringify(kind)}.`)
      }
    }),
  )
  const duplicateReferences = Object.keys(nodes).filter((reference) => triggers[reference] != null)
  if (duplicateReferences.length > 0) {
    throw new CliError('flow.apply-invalid', `Flow apply references must be unique across nodes and triggers: ${duplicateReferences.join(', ')}.`)
  }

  const edgeValues = root.edges ?? []
  if (!Array.isArray(edgeValues)) throw new CliError('flow.apply-invalid', 'Flow apply edges must be an array.')
  const edges = edgeValues.map((candidate, index) => {
    const edge = applyObject(candidate, `edges[${index}] must be an object.`)
    applyKeys(edge, ['sourceHandle', 'source', 'target'], `edges[${index}]`)
    return {
      sourceHandle: edge.sourceHandle == null ? undefined : applyString(edge.sourceHandle, `edges[${index}].sourceHandle`),
      source: applyString(edge.source, `edges[${index}].source`),
      target: applyString(edge.target, `edges[${index}].target`),
    }
  })
  if (Object.keys(nodes).length == 0 && Object.keys(triggers).length == 0 && edges.length == 0) {
    throw new CliError('flow.apply-invalid', 'Flow apply input contains no changes.')
  }
  return { edges, nodes, triggers, version: 1 }
}
