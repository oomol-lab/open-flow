import type {
  CodeModule,
  FlowDocument,
  Graph,
  GraphNode,
  Group,
  InlineTaskDefinition,
  InputMapping,
  InputPort,
  JsonValue,
  OutputMapping,
  Port,
  RevisionContent,
  TriggerKeySnapshot,
  TriggerNode,
  TriggerSchedule,
  WebhookOptions,
} from '@oomol-lab/open-flow/flow-change'

const encoder = new TextEncoder()

export const maxJsonDepth = 64

function canonicalText(value: JsonValue): string {
  if (value == null || typeof value == 'boolean' || typeof value == 'string' || typeof value == 'number') return JSON.stringify(value)

  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`

  const object = value as Readonly<Record<string, JsonValue>>
  return `{${Object.keys(object)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalText(object[key]!)}`)
    .join(',')}}`
}

export function canonicalJsonBytes(value: JsonValue): Uint8Array {
  return encoder.encode(canonicalText(value))
}

export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  const value = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return `sha256:${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function entries<T>(value: Readonly<Record<string, T>>): readonly (readonly [string, T])[] {
  return Object.keys(value)
    .toSorted()
    .map((key) => [key, value[key]!] as const)
}

function canonicalPort(value: InputPort | Port | Group): { readonly [key: string]: JsonValue } {
  if (!('handle' in value)) return value.collapsed == null ? { group: value.group } : { collapsed: value.collapsed, group: value.group }
  return {
    ...(value.description == null ? {} : { description: value.description }),
    handle: value.handle,
    jsonSchema: value.jsonSchema,
    nullable: value.nullable,
    ...(Object.hasOwn(value, 'value') ? { value: (value as InputPort).value! } : {}),
  }
}

export function canonicalPorts(value: readonly (InputPort | Port | Group)[]): JsonValue {
  return value.map(canonicalPort)
}

function canonicalInputMapping(value: InputMapping): JsonValue {
  switch (value.kind) {
    case 'sources':
      return { kind: value.kind, sources: value.sources.map((source) => ({ ...source })) }
    case 'value':
      return { kind: value.kind, value: value.value }
  }
}

function canonicalInputs(value: Readonly<Record<string, InputMapping>>): JsonValue {
  return Object.fromEntries(entries(value).map(([handle, mapping]) => [handle, canonicalInputMapping(mapping)]))
}

export function canonicalOutputs(value: readonly (OutputMapping & Port)[]): JsonValue {
  return value.map((output) => ({
    ...(output.description == null ? {} : { description: output.description }),
    handle: output.handle,
    jsonSchema: output.jsonSchema,
    nullable: output.nullable,
    sources: output.sources.map((source) => ({ ...source })),
  }))
}

function canonicalNode(value: GraphNode): JsonValue {
  if (!('inputs' in value)) return canonicalTriggerNode(value)
  const common = {
    concurrency: value.concurrency,
    ...(value.description == null ? {} : { description: value.description }),
    ...(value.icon == null ? {} : { icon: value.icon }),
    inputs: canonicalInputs(value.inputs),
    ...(value.name == null ? {} : { name: value.name }),
    ...(value.timeoutMs == null ? {} : { timeoutMs: value.timeoutMs }),
  }
  switch (value.kind) {
    case 'condition':
      return {
        ...common,
        cases: value.cases.map((condition) => ({
          expressions: condition.expressions.map((expression) => ({
            input: expression.input,
            operator: expression.operator,
            ...(Object.hasOwn(expression, 'value') ? { value: expression.value! } : {}),
          })),
          output: condition.output,
          relation: condition.relation,
        })),
        ...(value.defaultOutput == null ? {} : { defaultOutput: value.defaultOutput }),
        input: { handle: value.input.handle, ...canonicalPort(value.input) },
        kind: value.kind,
      }
    case 'subflow':
      return { ...common, kind: value.kind, subflowId: value.subflowId }
    case 'task':
      return value.task != null
        ? {
            ...common,
            ...(value.additionalInputs == null ? {} : { additionalInputs: canonicalPorts(value.additionalInputs) }),
            kind: value.kind,
            task: canonicalInlineTask(value.task),
          }
        : {
            ...common,
            ...(value.additionalInputs == null ? {} : { additionalInputs: canonicalPorts(value.additionalInputs) }),
            kind: value.kind,
            taskId: value.taskId,
          }
    case 'value':
      return { ...common, kind: value.kind, values: canonicalPorts(value.values) }
  }
}

export function canonicalGraph(value: Graph): JsonValue {
  return {
    nodes: Object.fromEntries(entries(value.nodes).map(([id, node]) => [id, canonicalNode(node)])),
  }
}

export function canonicalTask(task: FlowDocument['tasks'][string]): JsonValue {
  return {
    executor: task.executor,
    inputs: canonicalPorts(task.inputs),
    name: task.name,
    outputs: canonicalPorts(task.outputs),
  }
}

function canonicalInlineTask(task: InlineTaskDefinition): JsonValue {
  return {
    ...(task.capabilities == null ? {} : { capabilities: task.capabilities.map(({ action, connectionId, kind }) => ({ action, connectionId, kind })) }),
    inputs: canonicalPorts(task.inputs),
    moduleId: task.moduleId,
    name: task.name,
    outputs: canonicalPorts(task.outputs),
  }
}

function canonicalTriggerDefinition(snapshot: TriggerKeySnapshot): JsonValue {
  return {
    configSchema: snapshot.configSchema,
    definitionVersion: snapshot.definitionVersion,
    description: snapshot.description,
    displayName: snapshot.displayName,
    ...(snapshot.type == 'integration'
      ? {
          endpoint: {
            body: {
              allowArray: snapshot.endpoint.body.allowArray,
              allowEmpty: snapshot.endpoint.body.allowEmpty,
              formats: snapshot.endpoint.body.formats,
            },
            methods: snapshot.endpoint.methods,
            successStatus: snapshot.endpoint.successStatus,
          },
        }
      : {}),
    key: snapshot.key,
    name: snapshot.name,
    payloadSchema: snapshot.payloadSchema,
    provider: snapshot.provider,
    type: snapshot.type,
  }
}

function canonicalWebhookOptions(value: WebhookOptions): JsonValue {
  return {
    ...(value.allowedMethods == null ? {} : { allowedMethods: value.allowedMethods }),
    ...(value.allowedOrigins == null ? {} : { allowedOrigins: value.allowedOrigins }),
    ...(value.noResponseBody == null ? {} : { noResponseBody: value.noResponseBody }),
    ...(value.responseData == null ? {} : { responseData: value.responseData }),
    ...(value.responseHeaders == null ? {} : { responseHeaders: value.responseHeaders }),
    ...(value.responseStatusCode == null ? {} : { responseStatusCode: value.responseStatusCode }),
  }
}

function canonicalTriggerSchedule(value: TriggerSchedule): JsonValue {
  switch (value.type) {
    case 'cron':
      return { expression: value.expression, timezone: value.timezone, type: value.type }
    case 'every':
      return { type: value.type, unit: value.unit, value: value.value }
  }
}

function canonicalTriggerNode(trigger: TriggerNode): JsonValue {
  const common = (kind: TriggerNode['kind']): { readonly [key: string]: JsonValue } => ({
    ...(trigger.description == null ? {} : { description: trigger.description }),
    ...(trigger.icon == null ? {} : { icon: trigger.icon }),
    kind,
    name: trigger.name,
  })
  switch (trigger.kind) {
    case 'webhook':
      return {
        ...common(trigger.kind),
        inputsDef: trigger.inputsDef.map((input) => ({ handle: input.handle, ...canonicalPort(input) })),
        ...(trigger.options == null ? {} : { options: canonicalWebhookOptions(trigger.options) }),
      }
    case 'cron':
      return { ...common(trigger.kind), cronTimes: trigger.cronTimes.map(canonicalTriggerSchedule) }
    case 'poll':
      return {
        ...common(trigger.kind),
        bindingId: trigger.bindingId,
        config: trigger.config,
        definition: canonicalTriggerDefinition(trigger.definition),
        pollTimes: trigger.pollTimes.map(canonicalTriggerSchedule),
      }
    case 'integration':
      return {
        ...common(trigger.kind),
        bindingId: trigger.bindingId,
        config: trigger.config,
        definition: canonicalTriggerDefinition(trigger.definition),
      }
  }
}

export function canonicalDocument(document: FlowDocument): JsonValue {
  return {
    bindings: Object.fromEntries(entries(document.bindings)),
    graph: canonicalGraph(document.graph),
    subflows: Object.fromEntries(
      entries(document.subflows).map(([id, subflow]) => [
        id,
        {
          graph: canonicalGraph(subflow.graph),
          inputs: canonicalPorts(subflow.inputs),
          name: subflow.name,
          outputs: canonicalOutputs(subflow.outputs),
        },
      ]),
    ),
    tasks: Object.fromEntries(entries(document.tasks).map(([id, task]) => [id, canonicalTask(task)])),
  }
}

export function canonicalModule(module: CodeModule): JsonValue {
  return { imports: module.imports.toSorted(), name: module.name, source: module.source }
}

function canonicalRevision(content: RevisionContent): JsonValue {
  return {
    document: canonicalDocument(content.document),
    kind: 'open-flow-flow-revision',
    modelVersion: content.modelVersion,
    modules: Object.fromEntries(entries(content.modules).map(([id, module]) => [id, canonicalModule(module)])),
    version: 1,
  }
}

export function encodeRevision(content: RevisionContent): Uint8Array {
  return canonicalJsonBytes(canonicalRevision(content))
}
