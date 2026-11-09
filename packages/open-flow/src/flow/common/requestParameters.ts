import type { InputMapping, InputPort, JsonValue, TaskDefinitionBase, TaskExecutor } from './model.ts'

import { dequal } from 'dequal/lite'
import { z } from 'zod'
import { httpHeaderNameIssue } from '../../http/common/headers.ts'
import { remapInputMappings, renamedPort } from './portChanges.ts'

export const requestParameterSchema = z.strictObject({ mode: z.enum(['fields', 'object']).default('fields'), names: z.array(z.string()).default([]) })
export type RequestParameters = z.infer<typeof requestParameterSchema>
export interface RequestParameterConfig {
  readonly query: RequestParameters
  readonly headers: RequestParameters
}
export interface RequestTaskNode {
  readonly inputs: Readonly<Record<string, InputMapping>>
  readonly task: TaskDefinitionBase & { readonly executor?: TaskExecutor }
}

export function requestParameterHandle(group: 'query' | 'headers', name: string): string {
  return `${group === 'query' ? 'query' : 'header'}.${name}`
}

export function requestParameterPorts(
  config: RequestParameterConfig,
  querySchema: JsonValue,
  queryValueSchema: JsonValue,
  headerSchema: JsonValue,
): InputPort[] {
  return (['query', 'headers'] as const).flatMap((group): InputPort[] =>
    config[group].mode === 'object'
      ? [{ handle: group, jsonSchema: group === 'query' ? querySchema : headerSchema, nullable: true }]
      : config[group].names
          .filter((name) => name.trim())
          .map((name) => ({
            handle: requestParameterHandle(group, name),
            jsonSchema: group === 'query' ? queryValueSchema : { type: 'string' },
            nullable: true,
          })),
  )
}

export function retainRequestPorts(ports: readonly InputPort[], old: TaskDefinitionBase['inputs'] = []): TaskDefinitionBase['inputs'] {
  const remaining = new Map(ports.map((port) => [port.handle, port]))
  return [
    ...old.flatMap((item): TaskDefinitionBase['inputs'] => {
      if ('group' in item) return [item]
      const next = remaining.get(item.handle)
      if (next == null) return []
      remaining.delete(item.handle)
      return [dequal(item.jsonSchema, next.jsonSchema) && item.nullable == next.nullable ? item : next]
    }),
    ...remaining.values(),
  ]
}

export interface RequestParameterIssue {
  readonly field: 'query' | 'headers'
  readonly index: number
  readonly code: 'parameterNamesInvalid' | 'headerNameInvalid'
  readonly message: string
}

export function requestParameterIssues(config: RequestParameterConfig): RequestParameterIssue[] {
  const issues: RequestParameterIssue[] = []
  for (const group of ['query', 'headers'] as const) {
    if (config[group].mode !== 'fields') continue
    const seen = new Set<string>()
    for (const [index, name] of config[group].names.entries()) {
      const key = group === 'headers' ? name.toLowerCase() : name
      if (!name.trim() || seen.has(key))
        issues.push({ field: group, index, code: 'parameterNamesInvalid', message: 'Parameter names must be nonempty and unique.' })
      seen.add(key)
      if (group === 'headers' && httpHeaderNameIssue(name, []) === 'invalid')
        issues.push({ field: group, index, code: 'headerNameInvalid', message: 'Invalid HTTP header name.' })
    }
  }
  return issues
}

/** Only a named parameter rename carries a source; changing modes does not rename a port. */
export function requestInputMappings(
  mappings: Readonly<Record<string, InputMapping>>,
  previous: TaskDefinitionBase,
  next: TaskDefinitionBase,
): Record<string, InputMapping> {
  const candidate = renamedPort(previous.inputs, next.inputs)
  const rename = candidate != null && ['query.', 'header.'].some((prefix) => candidate.every((name) => name.startsWith(prefix))) ? candidate : undefined
  return remapInputMappings(mappings, next.inputs, rename)
}

export function withRequestParameterFields<Node extends RequestTaskNode>(
  node: Node,
  group: 'query' | 'headers',
  values: Record<string, JsonValue>,
  previous: RequestParameters,
  createTask: (parameters: RequestParameters) => Node['task'],
): Node {
  const task = createTask({ mode: 'fields', names: Object.keys(values) })
  const inputs = requestInputMappings(node.inputs, node.task, task)
  const rename = renamedPort(node.task.inputs, task.inputs)
  for (const [name, value] of Object.entries(values)) {
    const handle = requestParameterHandle(group, name)
    const existing = previous.mode === 'fields' && (previous.names.includes(name) || rename?.[1] === handle)
    if (inputs[handle] == null && !existing) inputs[handle] = { kind: 'value', value }
  }
  return { ...node, task, inputs }
}

export function withRequestParameterSource<Node extends RequestTaskNode>(
  node: Node,
  group: 'query' | 'headers',
  mapping: InputMapping | undefined,
  createTask: (parameters: RequestParameters) => Node['task'],
): Node {
  const task = createTask({ mode: 'object', names: [] })
  const inputs = requestInputMappings(node.inputs, node.task, task)
  if (mapping == null) delete inputs[group]
  else inputs[group] = mapping
  return { ...node, task, inputs }
}
