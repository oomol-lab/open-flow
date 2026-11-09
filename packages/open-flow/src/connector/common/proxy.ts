import type { SourceOperation, SourceReferenceOperation } from '../../event-source/common/definition.ts'
import type { InputMapping, InputPort, ManagedTaskDefinitionOf, TaskDefinitionBase } from '../../flow/common/model.ts'
import type { RequestTaskNode } from '../../flow/common/requestParameters.ts'
import type { JsonValue } from '../../types/index.ts'

import { z } from 'zod'
import {
  requestParameterSchema,
  requestParameterHandle,
  requestParameterIssues,
  requestParameterPorts,
  requestInputMappings,
  retainRequestPorts,
  withRequestParameterFields,
  withRequestParameterSource,
} from '../../flow/common/requestParameters.ts'
export type TriggerOperationRequest =
  | { readonly operation: 'sourceReference'; readonly request: SourceReferenceOperation }
  | { readonly operation: 'source'; readonly request: SourceOperation }
  | { readonly operation: 'read'; readonly config: Readonly<Record<string, JsonValue>>; readonly checkpoint: JsonValue }
  | { readonly operation: 'options'; readonly config: Readonly<Record<string, JsonValue>>; readonly field: string }
  | {
      readonly operation: 'reconcile'
      readonly subscriptionId?: string
      readonly config: Readonly<Record<string, JsonValue>>
      readonly requestKey: string
      readonly endpointUrl: string
      readonly active: boolean
    }
  | {
      readonly operation: 'receive'
      readonly subscriptionId: string
      readonly method: string
      readonly headers: Readonly<Record<string, string>>
      readonly query: Readonly<Record<string, string>>
      readonly rawBody: string
      readonly admit: boolean
      readonly current: boolean
    }
  | { readonly operation: 'resource'; readonly config: Readonly<Record<string, JsonValue>>; readonly requestKey: string; readonly active: boolean }

export interface ConnectorProxyRequest {
  readonly body?: unknown
  readonly endpoint: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  readonly query?: Readonly<Record<string, boolean | number | string | null>>
}

export interface ConnectorProxyResult {
  readonly data: unknown
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly bodyEncoding?: 'base64'
}

export interface ConnectorProxy {
  trigger?(request: TriggerOperationRequest, signal?: AbortSignal): Promise<unknown>
  execute(request: ConnectorProxyRequest, signal?: AbortSignal): Promise<ConnectorProxyResult>
}

export const connectorProxyConfigSchema = z.strictObject({
  providerId: z.string().min(1),
  connectionId: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  query: requestParameterSchema.default({ mode: 'fields', names: [] }),
  headers: requestParameterSchema.default({ mode: 'fields', names: [] }),
  bodyFormat: z.enum(['none', 'json']).default('none'),
})
export type ConnectorProxyConfig = z.infer<typeof connectorProxyConfigSchema>
export interface ConnectorProxyExecutor extends ConnectorProxyConfig {
  readonly kind: 'connector-proxy'
}
export const connectorProxyExecutorSchema = connectorProxyConfigSchema.extend({ kind: z.literal('connector-proxy') })
export const connectorProxyQueryValueSchema = { type: ['string', 'number', 'boolean', 'null'] }
export const connectorProxyQuerySchema = { type: 'object', additionalProperties: connectorProxyQueryValueSchema }
export const connectorProxyHeaderSchema = { type: 'object', additionalProperties: { type: 'string' } }
export const connectorProxyBodyInput: InputPort = { handle: 'body', jsonSchema: {}, nullable: true }

export function connectorProxySupportsBody(method: ConnectorProxyRequest['method']): boolean {
  return method !== 'GET'
}

export function connectorProxyHasBody(mapping: InputMapping | undefined, defaultValue?: JsonValue): boolean {
  if (mapping?.kind === 'unset') return false
  return mapping == null ? defaultValue !== undefined : mapping.kind === 'value' || mapping.sources.length > 0
}

export function connectorProxyTask(
  config: ConnectorProxyConfig,
  name = 'Custom API Request',
  previous?: TaskDefinitionBase,
): ManagedTaskDefinitionOf<ConnectorProxyExecutor> {
  const { connectionId, ...settings } = config
  const inputs: InputPort[] = [
    { handle: 'endpoint', jsonSchema: { type: 'string' }, nullable: false },
    ...requestParameterPorts(config, connectorProxyQuerySchema, connectorProxyQueryValueSchema, connectorProxyHeaderSchema),
    ...(config.bodyFormat === 'none' ? [] : [connectorProxyBodyInput]),
  ]
  const outputs: InputPort[] = [
    { handle: 'body', jsonSchema: {}, nullable: true },
    { handle: 'statusCode', jsonSchema: { type: 'integer' }, nullable: false },
    { handle: 'headers', jsonSchema: connectorProxyHeaderSchema, nullable: false },
    { handle: 'bodyEncoding', jsonSchema: { const: 'base64' }, nullable: true },
  ]
  return {
    name,
    executor: { ...settings, ...(connectionId === undefined ? {} : { connectionId }), kind: 'connector-proxy' },
    inputs: retainRequestPorts(inputs, previous?.inputs),
    outputs: retainRequestPorts(outputs, previous?.outputs),
  }
}

export function connectorProxyInputs(
  mappings: Readonly<Record<string, InputMapping>>,
  previous: RequestTaskNode['task'],
  next: RequestTaskNode['task'],
): Record<string, InputMapping> {
  const inputs = requestInputMappings(mappings, previous, next)
  const before = previous.executor?.kind === 'connector-proxy' ? (previous.executor as ConnectorProxyExecutor) : undefined
  const after = next.executor?.kind === 'connector-proxy' ? (next.executor as ConnectorProxyExecutor) : undefined
  if (before != null && after != null && connectorProxySupportsBody(before.method) && !connectorProxySupportsBody(after.method)) {
    const bodyPort = next.inputs.find((port): port is InputPort => 'handle' in port && port.handle === 'body')
    if (connectorProxyHasBody(inputs.body, bodyPort?.value)) inputs.body = { kind: 'unset' }
  }
  return inputs
}

export function connectorProxyIssues(config: ConnectorProxyConfig, hasBody = config.bodyFormat !== 'none') {
  return [
    ...requestParameterIssues(config),
    ...(!connectorProxySupportsBody(config.method) && hasBody
      ? [{ field: 'bodyFormat' as const, code: 'bodyUnsupported' as const, message: 'GET does not support a request body.' }]
      : []),
  ]
}

export function buildConnectorProxyRequest(
  config: ConnectorProxyConfig,
  input: Readonly<Record<string, JsonValue>>,
  mappings?: Readonly<Record<string, InputMapping>>,
  bodyDefault?: JsonValue,
): ConnectorProxyRequest {
  const hasBody = mappings == null ? input.body !== undefined : connectorProxyHasBody(mappings.body, bodyDefault)
  if (connectorProxyIssues(config, hasBody).length > 0) throw new Error('Invalid Provider API request configuration.')
  const endpoint = input.endpoint
  if (typeof endpoint !== 'string' || !endpoint.trim()) throw new Error('An endpoint is required.')
  const parameters = (group: 'query' | 'headers'): Record<string, JsonValue> => {
    if (config[group].mode === 'object') {
      const value = input[group]
      if (value == null) return {}
      if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a parameter object.')
      return { ...(value as Readonly<Record<string, JsonValue>>) }
    }
    return Object.fromEntries(
      config[group].names.flatMap((name) => {
        const handle = requestParameterHandle(group, name)
        if (mappings != null && (mappings[handle] == null || mappings[handle]?.kind === 'unset')) return []
        const value = input[handle]
        return value === undefined || (group === 'headers' && value === null) ? [] : [[name, value]]
      }),
    )
  }
  const query = parameters('query')
  const headers = parameters('headers')
  if (Object.values(query).some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))
    throw new Error('Query parameters require scalar values.')
  if (Object.values(headers).some((value) => typeof value !== 'string')) throw new Error('Headers require text values.')
  return {
    endpoint,
    method: config.method,
    query: query as NonNullable<ConnectorProxyRequest['query']>,
    headers: headers as Readonly<Record<string, string>>,
    ...(hasBody ? { body: input.body ?? null } : {}),
  }
}

export function withConnectorProxyParameterFields<Node extends RequestTaskNode>(
  node: Node,
  group: 'query' | 'headers',
  values: Record<string, JsonValue>,
): Node {
  const executor = node.task.executor
  if (executor?.kind !== 'connector-proxy') return node
  const config = executor as ConnectorProxyExecutor
  return withRequestParameterFields(node, group, values, config[group], (parameters) =>
    connectorProxyTask({ ...config, [group]: parameters }, node.task.name, node.task),
  )
}

export function withConnectorProxyParameterSource<Node extends RequestTaskNode>(node: Node, group: 'query' | 'headers', mapping?: InputMapping): Node {
  const executor = node.task.executor
  if (executor?.kind !== 'connector-proxy') return node
  const config = executor as ConnectorProxyExecutor
  return withRequestParameterSource(node, group, mapping, (parameters) => connectorProxyTask({ ...config, [group]: parameters }, node.task.name, node.task))
}
