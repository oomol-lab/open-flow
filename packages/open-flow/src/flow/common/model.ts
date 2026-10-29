import type { JsonValue, Port, PortDefinition } from '../../types/index.ts'

export type { JsonValue, Port, PortDefinition } from '../../types/index.ts'

/** Primitives shared by every node family. Node unions and graph operations belong to change.ts. */

export interface RetryConfiguration {
  readonly maxRetries: number
  readonly intervalMs: number
}

export interface InputPortDefinition extends PortDefinition {
  readonly value?: JsonValue
}

export interface InputPort extends InputPortDefinition {
  readonly handle: string
}

export interface Group {
  readonly collapsed?: boolean
  readonly group: string
}

export function portsByHandle<Value extends Port>(ports: readonly (Value | Group)[]): Readonly<Record<string, Value>> {
  return Object.fromEntries(ports.flatMap((port) => ('handle' in port ? [[port.handle, port]] : [])))
}

export interface NodeSource {
  readonly system?: true
  readonly field?: string
  readonly kind: 'node'
  readonly nodeId: string
  readonly output: string
}

export interface BindingSource {
  readonly bindingId: string
  readonly kind: 'binding'
}

export type FixedInputValue = { readonly kind: 'unset' } | { readonly kind: 'value'; readonly value: JsonValue }
export type InputValues = Readonly<Record<string, FixedInputValue>>

export type InputMapping = FixedInputValue | { readonly kind: 'sources'; readonly sources: readonly (BindingSource | NodeSource)[] }

export interface GraphNodeBase {
  readonly description?: string
  readonly icon?: string
  readonly inputs: Readonly<Record<string, InputMapping>>
  readonly name?: string
  readonly maxExecutions?: number
  readonly timeoutMs?: number
  readonly retry?: RetryConfiguration
  readonly onError?: 'stop' | 'error'
}

export type Source = BindingSource | NodeSource

export interface WorkflowCapability {
  readonly kind: 'workflow'
  readonly name: string
  readonly flowId: string
  readonly revisionId: string
  readonly inputs: readonly Port[]
  readonly outputs: readonly Port[] | null
}

export type TaskCapability = ConnectorCapability | WorkflowCapability

export interface ConnectorAccessCapability {
  readonly actionHints?: readonly string[]
  readonly connectionHints?: readonly {
    readonly action: string
    readonly connectionId: string
    readonly alias?: string
  }[]
  readonly kind: 'connector'
}

export interface ConnectorActionCapability {
  readonly action: string
  readonly connections: readonly { readonly connectionId: string; readonly alias?: string }[]
  readonly connectionId?: string
  readonly kind: 'connector'
}

export type ConnectorPermissionCapability =
  | { readonly kind: 'connector'; readonly mode: 'shared' }
  | { readonly kind: 'connector'; readonly mode: 'independent'; readonly actions: readonly { readonly action: string; readonly connectionId?: string }[] }

export type ConnectorCapability = ConnectorAccessCapability | ConnectorActionCapability | ConnectorPermissionCapability

export interface TaskDefinitionBase {
  readonly inputs: readonly (InputPort | Group)[]
  readonly name: string
  readonly outputs: readonly (Port | Group)[]
}

export interface InlineTaskDefinition extends TaskDefinitionBase {
  readonly capabilities?: readonly TaskCapability[]
  readonly moduleId: string
}

/** The executor shape every managed Task shares; each node family narrows it with its own executor. */
export interface TaskExecutor {
  readonly kind: string
}

export interface ManagedTaskDefinitionOf<Executor extends TaskExecutor> extends TaskDefinitionBase {
  readonly executor: Executor
}

export interface WorkflowExecutor {
  readonly kind: 'workflow'
  readonly flowId: string
  readonly revisionId: string
}

export interface CodeModule {
  readonly imports: readonly string[]
  readonly name: string
  readonly source: string
}
