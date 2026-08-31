import type {
  BindingSource,
  FlowDocument,
  FlowSource,
  Graph,
  GraphNode,
  InputMapping,
  InputPortDefinition,
  JsonValue,
  NodeSource,
  PortDefinition,
  RevisionContent,
  TriggerNode,
} from '@oomol-lab/open-flow/flow-change'
import type { EngineContract } from '../../execution/common/engineContract.ts'
import type { RuntimeProgram } from '../../execution/common/runtime.ts'

import { parse } from '@babel/parser'
import { findEngineContract } from '../../execution/common/engineContract.ts'
import { portsByHandle, validVariableName } from './change.ts'
import { canonicalGraph, canonicalJsonBytes, canonicalModule, canonicalOutputs, canonicalPorts, canonicalTask, digestBytes } from './encoding.ts'

export interface SemanticClosure {
  readonly dependencies: {
    readonly bindings: ReadonlySet<string>
    readonly inputBindings: ReadonlySet<string>
    readonly modules: ReadonlySet<string>
    readonly subflows: ReadonlySet<string>
    readonly tasks: ReadonlySet<string>
  }
  readonly digest: string
}

function entries<T>(value: Readonly<Record<string, T>>): readonly (readonly [string, T])[] {
  return Object.keys(value)
    .toSorted()
    .map((key) => [key, value[key]!] as const)
}

export async function flowClosure(content: RevisionContent): Promise<SemanticClosure> {
  const bindings = new Set<string>()
  const inputBindings = new Set<string>()
  const modules = new Set<string>()
  const subflows = new Set<string>()
  const tasks = new Set<string>()

  function visitBinding(id: string): void {
    bindings.add(id)
  }

  function visitModule(id: string): void {
    if (modules.has(id)) return
    modules.add(id)
    const module = content.modules[id]
    if (module == null) return
    for (const imported of module.imports.toSorted()) visitModule(imported)
  }

  function visitInputMappings(value: Readonly<Record<string, InputMapping>>): void {
    for (const mapping of Object.values(value)) {
      if (mapping.kind != 'sources') continue
      for (const source of mapping.sources) {
        if (source.kind != 'binding') continue
        inputBindings.add(source.bindingId)
        visitBinding(source.bindingId)
      }
    }
  }

  function visitGraph(value: Graph): void {
    for (const [, node] of entries(value.nodes)) {
      if ('inputs' in node) visitInputMappings(node.inputs)
      switch (node.kind) {
        case 'condition':
          break
        case 'subflow':
          visitSubflow(node.subflowId)
          break
        case 'task':
          if (node.task != null) visitModule(node.task.moduleId)
          else tasks.add(node.taskId)
          break
        case 'value':
          break
        case 'poll':
        case 'integration':
          visitBinding(node.bindingId)
          break
        case 'cron':
        case 'webhook':
          break
      }
    }
  }

  function visitSubflow(id: string): void {
    if (subflows.has(id)) return
    subflows.add(id)
    const subflow = content.document.subflows[id]
    if (subflow != null) visitGraph(subflow.graph)
  }

  visitGraph(content.document.graph)

  const bytes = canonicalJsonBytes({
    bindings: Object.fromEntries([...bindings].toSorted().map((id) => [id, content.document.bindings[id] ?? null])),
    graph: canonicalGraph(content.document.graph),
    kind: 'open-flow-semantic-closure',
    modelVersion: content.modelVersion,
    modules: Object.fromEntries([...modules].toSorted().map((id) => [id, content.modules[id] == null ? null : canonicalModule(content.modules[id])])),
    tasks: Object.fromEntries([...tasks].toSorted().map((id) => [id, content.document.tasks[id] == null ? null : canonicalTask(content.document.tasks[id])])),
    subflows: Object.fromEntries(
      [...subflows].toSorted().map((id) => {
        const subflow = content.document.subflows[id]
        if (subflow == null) return [id, null]
        return [
          id,
          {
            graph: canonicalGraph(subflow.graph),
            inputs: canonicalPorts(subflow.inputs),
            name: subflow.name,
            outputs: canonicalOutputs(subflow.outputs),
          },
        ]
      }),
    ),
    version: 1,
  })
  return { dependencies: { bindings, inputBindings, modules, subflows, tasks }, digest: await digestBytes(bytes) }
}

export function variableBindings(revision: RevisionContent, bindingIds: Iterable<string>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...bindingIds].flatMap((bindingId) => {
      const binding = revision.document.bindings[bindingId]
      return binding?.kind == 'variable' ? [[bindingId, binding.target]] : []
    }),
  )
}

export interface Diagnostic {
  readonly code: string
  readonly column: number
  readonly line: number
  readonly message: string
  readonly path: string
  readonly values?: Readonly<Record<string, string | number>>
}

interface ImportReference {
  readonly column: number
  readonly imported: readonly string[]
  readonly line: number
  readonly specifier: string
}

interface ModuleAnalysis {
  readonly exports: ReadonlySet<string>
  readonly imports: readonly ImportReference[]
}

export interface FlowValidation {
  readonly closure: SemanticClosure
  readonly diagnostics: readonly Diagnostic[]
  readonly valid: boolean
}

export function triggerPayloadSchema(trigger: TriggerNode): JsonValue {
  if (trigger.kind == 'poll' || trigger.kind == 'integration') return trigger.definition.payloadSchema
  if (trigger.kind == 'cron') return { additionalProperties: false, type: 'object' }
  return {
    additionalProperties: false,
    properties: Object.fromEntries(trigger.inputsDef.map((input) => [input.handle, input.jsonSchema])),
    required: trigger.inputsDef.filter((input) => !input.nullable && !Object.hasOwn(input, 'value')).map((input) => input.handle),
    type: 'object',
  }
}

function location(value: { readonly loc?: { readonly start: { readonly column: number; readonly line: number } } | null }): {
  readonly column: number
  readonly line: number
} {
  return { column: value.loc?.start.column ?? 0, line: value.loc?.start.line ?? 1 }
}

function modulePath(moduleId: string): string {
  return `/modules/${moduleId}/source`
}

function bindingNames(value: unknown, names: Set<string>): void {
  if (value == null || typeof value != 'object') return
  const node = value as {
    readonly argument?: unknown
    readonly elements?: readonly unknown[]
    readonly left?: unknown
    readonly name?: unknown
    readonly properties?: readonly unknown[]
    readonly type?: unknown
  }
  if (node.type == 'Identifier' && typeof node.name == 'string') names.add(node.name)
  else if (node.type == 'RestElement') bindingNames(node.argument, names)
  else if (node.type == 'AssignmentPattern') bindingNames(node.left, names)
  else if (node.type == 'ArrayPattern') for (const element of node.elements ?? []) bindingNames(element, names)
  else if (node.type == 'ObjectPattern') {
    for (const property of node.properties ?? []) {
      const candidate = property as { readonly argument?: unknown; readonly type?: unknown; readonly value?: unknown }
      bindingNames(candidate.type == 'RestElement' ? candidate.argument : candidate.value, names)
    }
  }
}

function importedName(value: unknown): string | undefined {
  if (value == null || typeof value != 'object') return
  const node = value as { readonly name?: unknown; readonly type?: unknown; readonly value?: unknown }
  if (node.type == 'Identifier' && typeof node.name == 'string') return node.name
  if (node.type == 'StringLiteral' && typeof node.value == 'string') return node.value
}

function analyzeModule(moduleId: string, source: string, diagnostics: Diagnostic[]): ModuleAnalysis | undefined {
  let program: ReturnType<typeof parse>['program']
  try {
    program = parse(source, {
      createImportExpressions: true,
      sourceFilename: modulePath(moduleId),
      sourceType: 'module',
    }).program
  } catch (error) {
    const sourceLocation = error != null && typeof error == 'object' ? Reflect.get(error, 'loc') : undefined
    diagnostics.push({
      code: 'module.syntax',
      column:
        sourceLocation != null && typeof sourceLocation == 'object' && typeof Reflect.get(sourceLocation, 'column') == 'number'
          ? Reflect.get(sourceLocation, 'column')
          : 0,
      line:
        sourceLocation != null && typeof sourceLocation == 'object' && typeof Reflect.get(sourceLocation, 'line') == 'number'
          ? Reflect.get(sourceLocation, 'line')
          : 1,
      message: `CodeModule "${moduleId}" contains invalid JavaScript syntax.`,
      path: modulePath(moduleId),
      values: { moduleId },
    })
    return
  }

  const exports = new Set<string>()
  const imports: ImportReference[] = []
  for (const statement of program.body) {
    if (statement.type == 'ImportDeclaration') {
      const imported = statement.specifiers.flatMap((specifier) => {
        if (specifier.type == 'ImportNamespaceSpecifier') return []
        if (specifier.type == 'ImportDefaultSpecifier') return ['default']
        const name = importedName(specifier.imported)
        return name == null ? [] : [name]
      })
      imports.push({ ...location(statement.source), imported, specifier: statement.source.value })
      continue
    }
    if (statement.type == 'ExportDefaultDeclaration') {
      exports.add('default')
      continue
    }
    if (statement.type != 'ExportNamedDeclaration') continue
    if (statement.source != null) {
      diagnostics.push({
        code: 'module.unsupported-import',
        ...location(statement.source),
        message: `CodeModule "${moduleId}" must import before re-exporting values.`,
        path: modulePath(moduleId),
        values: { moduleId, variant: 'reexport' },
      })
      continue
    }
    if (statement.declaration?.type == 'VariableDeclaration') {
      for (const declaration of statement.declaration.declarations) bindingNames(declaration.id, exports)
    } else if (
      (statement.declaration?.type == 'FunctionDeclaration' || statement.declaration?.type == 'ClassDeclaration') &&
      statement.declaration.id != null
    ) {
      exports.add(statement.declaration.id.name)
    }
    for (const specifier of statement.specifiers) {
      const name = importedName(specifier.exported)
      if (name != null) exports.add(name)
    }
  }

  const visit = (value: unknown): void => {
    if (value == null || typeof value != 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const node = value as Readonly<Record<string, unknown>>
    const callee = node.callee as { readonly name?: unknown; readonly type?: unknown } | undefined
    if (node.type == 'ImportExpression' || (node.type == 'CallExpression' && callee?.type == 'Import')) {
      diagnostics.push({
        code: 'module.dynamic-import',
        ...location(node),
        message: `CodeModule "${moduleId}" cannot use dynamic import.`,
        path: modulePath(moduleId),
        values: { moduleId },
      })
    } else if (node.type == 'CallExpression' && callee?.type == 'Identifier' && callee.name == 'require') {
      diagnostics.push({
        code: 'module.commonjs',
        ...location(node),
        message: `CodeModule "${moduleId}" cannot use CommonJS require.`,
        path: modulePath(moduleId),
        values: { moduleId },
      })
    } else if (
      (node.type == 'CallExpression' && callee?.type == 'Identifier' && (callee.name == 'eval' || callee.name == 'Function')) ||
      (node.type == 'NewExpression' && callee?.type == 'Identifier' && callee.name == 'Function')
    ) {
      diagnostics.push({
        code: 'module.dynamic-code',
        ...location(node),
        message: `CodeModule "${moduleId}" cannot evaluate dynamic code.`,
        path: modulePath(moduleId),
        values: { moduleId },
      })
    }
    for (const [key, child] of Object.entries(node)) {
      if (key != 'loc' && key != 'tokens' && key != 'comments') visit(child)
    }
  }
  visit(program)
  return { exports, imports }
}

function projectModule(specifier: string): string | undefined {
  const match = /^\.\/(.+)\.mjs$/.exec(specifier)
  return match?.[1]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareText(left.path, right.path) ||
    left.line - right.line ||
    left.column - right.column ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  )
}

function graphDiagnostic(code: string, message: string, path: string, values?: Readonly<Record<string, string | number>>): Diagnostic {
  return { code, column: 0, line: 1, message, path, ...(values == null ? {} : { values }) }
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true
  if (left == null || right == null || typeof left != 'object' || typeof right != 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length == right.length && left.every((value, index) => jsonEqual(value, right[index]!))
  }
  const leftEntries = Object.entries(left)
  const rightRecord = right as Readonly<Record<string, JsonValue>>
  return (
    leftEntries.length == Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && jsonEqual(value, rightRecord[key]!))
  )
}

function schemaObject(schema: JsonValue): Readonly<Record<string, JsonValue>> | undefined {
  return schema != null && typeof schema == 'object' && !Array.isArray(schema) ? (schema as Readonly<Record<string, JsonValue>>) : undefined
}

function schemaList(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function schemaTypeMatches(type: JsonValue | undefined, value: JsonValue): boolean {
  if (Array.isArray(type)) return type.some((candidate) => schemaTypeMatches(candidate, value))
  switch (type) {
    case undefined:
      return true
    case 'null':
      return value == null
    case 'boolean':
      return typeof value == 'boolean'
    case 'integer':
      return typeof value == 'number' && Number.isInteger(value)
    case 'number':
      return typeof value == 'number'
    case 'string':
      return typeof value == 'string'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return value != null && typeof value == 'object' && !Array.isArray(value)
    default:
      return false
  }
}

export function matchesSchema(value: JsonValue, schema: JsonValue): boolean {
  if (typeof schema == 'boolean') return schema
  const source = schemaObject(schema)
  if (source == null) return false
  const allOf = schemaList(source.allOf)
  if (allOf != null && !allOf.every((candidate) => matchesSchema(value, candidate))) return false
  const anyOf = schemaList(source.anyOf)
  if (anyOf != null && !anyOf.some((candidate) => matchesSchema(value, candidate))) return false
  const oneOf = schemaList(source.oneOf)
  if (oneOf != null && oneOf.filter((candidate) => matchesSchema(value, candidate)).length != 1) return false
  if (source.not != null && matchesSchema(value, source.not)) return false
  if (source.const != null && !jsonEqual(value, source.const)) return false
  const enumeration = schemaList(source.enum)
  if (enumeration != null && !enumeration.some((candidate) => jsonEqual(value, candidate))) return false
  if (!schemaTypeMatches(source.type, value)) return false
  if (typeof value == 'string') {
    if (typeof source.minLength == 'number' && value.length < source.minLength) return false
    if (typeof source.maxLength == 'number' && value.length > source.maxLength) return false
    if (typeof source.pattern == 'string') {
      try {
        if (!new RegExp(source.pattern, 'u').test(value)) return false
      } catch {
        return false
      }
    }
  }
  if (typeof value == 'number') {
    if (typeof source.minimum == 'number' && value < source.minimum) return false
    if (typeof source.maximum == 'number' && value > source.maximum) return false
    if (typeof source.exclusiveMinimum == 'number' && value <= source.exclusiveMinimum) return false
    if (typeof source.exclusiveMaximum == 'number' && value >= source.exclusiveMaximum) return false
  }
  if (Array.isArray(value)) {
    if (typeof source.minItems == 'number' && value.length < source.minItems) return false
    if (typeof source.maxItems == 'number' && value.length > source.maxItems) return false
    if (source.items != null && !value.every((item) => matchesSchema(item, source.items!))) return false
  }
  if (value != null && typeof value == 'object' && !Array.isArray(value)) {
    const objectValue = value as Readonly<Record<string, JsonValue>>
    const required = schemaList(source.required)
    if (required != null && required.some((key) => typeof key != 'string' || !Object.hasOwn(objectValue, key))) return false
    const properties = schemaObject(source.properties ?? {})
    if (properties == null) return false
    for (const [key, item] of Object.entries(objectValue)) {
      const property = properties[key]
      if (property != null) {
        if (!matchesSchema(item, property)) return false
      } else if (source.additionalProperties === false) return false
      else if (source.additionalProperties != null && source.additionalProperties !== true && !matchesSchema(item, source.additionalProperties)) return false
    }
  }
  return true
}

function schemaAssignable(sourceSchema: JsonValue, targetSchema: JsonValue): boolean {
  if (sourceSchema === true || targetSchema === true || jsonEqual(sourceSchema, {}) || jsonEqual(targetSchema, {})) return true
  if (sourceSchema === false || targetSchema === false) return false
  if (jsonEqual(sourceSchema, targetSchema)) return true
  const source = schemaObject(sourceSchema)
  const target = schemaObject(targetSchema)
  if (source == null || target == null || !jsonEqual(source.type ?? null, target.type ?? null)) return false
  if (source.type != 'object') return false
  const sourceProperties = schemaObject(source.properties ?? {})
  const targetProperties = schemaObject(target.properties ?? {})
  const sourceRequired = new Set((schemaList(source.required) ?? []).filter((key): key is string => typeof key == 'string'))
  const targetRequired = (schemaList(target.required) ?? []).filter((key): key is string => typeof key == 'string')
  if (sourceProperties == null || targetProperties == null || targetRequired.some((key) => !sourceRequired.has(key))) return false
  for (const [key, property] of Object.entries(sourceProperties)) {
    const targetProperty = targetProperties[key]
    if (targetProperty != null) {
      if (!schemaAssignable(property, targetProperty)) return false
    } else if (target.additionalProperties === false) return false
    else if (target.additionalProperties != null && target.additionalProperties !== true && !schemaAssignable(property, target.additionalProperties))
      return false
  }
  return source.additionalProperties === false || target.additionalProperties !== false
}

export function variableInputCompatible(jsonSchema: JsonValue): boolean {
  const schema = schemaObject(jsonSchema)
  const types = schemaList(schema?.type)
  if (schema != null && types?.includes('string')) return schemaAssignable({ type: 'string' }, { ...schema, type: 'string' })
  return schemaAssignable({ type: 'string' }, jsonSchema)
}

function hasRetiredRef(value: unknown): boolean {
  if (value == null || typeof value != 'object') return false
  const source = value as Readonly<Record<string, unknown>>
  return source.contentMediaType == 'oomol/ref' || Object.values(source).some(hasRetiredRef)
}

function validateTrigger(triggerId: string, trigger: TriggerNode, document: FlowDocument, path: string, diagnostics: Diagnostic[]): void {
  if (trigger.kind == 'webhook') {
    const handles = new Set<string>()
    for (const [index, input] of trigger.inputsDef.entries()) {
      if (handles.has(input.handle)) {
        diagnostics.push(
          graphDiagnostic(
            'trigger.input-duplicate',
            `Webhook Trigger input "${input.handle}" is declared more than once.`,
            `${path}/inputsDef/${index}/handle`,
            { input: input.handle },
          ),
        )
      }
      handles.add(input.handle)
    }
    return
  }
  if (trigger.kind == 'cron') return
  const binding = document.bindings[trigger.bindingId]
  if (binding == null) {
    diagnostics.push(
      graphDiagnostic('trigger.connection-missing', `Trigger Connection binding "${trigger.bindingId}" does not exist.`, `${path}/bindingId`, {
        bindingId: trigger.bindingId,
      }),
    )
  } else if (binding.kind != 'connection') {
    diagnostics.push(
      graphDiagnostic('trigger.connection-invalid', `Trigger binding "${trigger.bindingId}" must be a Connection.`, `${path}/bindingId`, {
        bindingId: trigger.bindingId,
      }),
    )
  }
  const configSchema = schemaObject(trigger.definition.configSchema)
  const missingConfig =
    schemaList(configSchema?.required)?.filter((name): name is string => typeof name == 'string' && !Object.hasOwn(trigger.config, name)) ?? []
  if (missingConfig.length > 0) {
    diagnostics.push(
      graphDiagnostic('trigger.config-incomplete', `Complete the required Trigger config fields: ${missingConfig.join(', ')}.`, `${path}/config`, {
        fields: missingConfig.join(', '),
      }),
    )
  } else if (!matchesSchema(trigger.config, trigger.definition.configSchema)) {
    diagnostics.push(
      graphDiagnostic('trigger.config-invalid', `Trigger "${triggerId}" config does not match its fixed definition.`, `${path}/config`, { triggerId }),
    )
  }
}

function nodeInputPorts(document: FlowDocument, node: GraphNode): Readonly<Record<string, InputPortDefinition>> {
  switch (node.kind) {
    case 'condition':
      return { [node.input.handle]: node.input }
    case 'value':
      return {}
    case 'subflow':
      return portsByHandle(document.subflows[node.subflowId]?.inputs ?? [])
    case 'task':
      return portsByHandle(node.task != null ? node.task.inputs : (document.tasks[node.taskId]?.inputs ?? []))
    case 'cron':
    case 'integration':
    case 'poll':
    case 'webhook':
      return {}
  }
}

function nodeOutputPorts(document: FlowDocument, node: GraphNode): Readonly<Record<string, PortDefinition>> {
  switch (node.kind) {
    case 'condition': {
      const outputs = [...node.cases.map((condition) => condition.output), ...(node.defaultOutput == null ? [] : [node.defaultOutput])]
      return Object.fromEntries(outputs.map((handle) => [handle, node.input]))
    }
    case 'value':
      return portsByHandle(node.values)
    case 'subflow':
      return portsByHandle(document.subflows[node.subflowId]?.outputs ?? [])
    case 'task':
      return portsByHandle(node.task != null ? node.task.outputs : (document.tasks[node.taskId]?.outputs ?? []))
    case 'cron':
    case 'integration':
    case 'poll':
    case 'webhook':
      return { payload: { jsonSchema: triggerPayloadSchema(node), nullable: false } }
  }
}

function checkSource(
  source: BindingSource | FlowSource | NodeSource,
  graph: Graph,
  document: FlowDocument,
  flowInputs: ReadonlySet<string> | undefined,
  targetInput: InputPortDefinition | undefined,
  path: string,
  diagnostics: Diagnostic[],
): void {
  switch (source.kind) {
    case 'binding':
      if (document.bindings[source.bindingId] == null) {
        diagnostics.push(graphDiagnostic('graph.binding-missing', `Binding "${source.bindingId}" does not exist.`, path, { bindingId: source.bindingId }))
      } else if (document.bindings[source.bindingId].kind != 'variable') {
        diagnostics.push(graphDiagnostic('graph.binding-invalid', `Binding "${source.bindingId}" must be a Variable.`, path, { bindingId: source.bindingId }))
      } else if (targetInput != null && !variableInputCompatible(targetInput.jsonSchema)) {
        diagnostics.push(
          graphDiagnostic('graph.variable-incompatible', `Variable binding "${source.bindingId}" is not compatible with this input.`, path, {
            bindingId: source.bindingId,
          }),
        )
      }
      return
    case 'flow':
      if (flowInputs?.has(source.input) != true) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Flow input "${source.input}" does not exist in this graph.`, path, {
            input: source.input,
            variant: 'flow-input',
          }),
        )
      }
      return
    case 'node': {
      const upstream = graph.nodes[source.nodeId]
      if (upstream == null) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Upstream node "${source.nodeId}" does not exist.`, path, {
            nodeId: source.nodeId,
            variant: 'node',
          }),
        )
        return
      }
      const output = nodeOutputPorts(document, upstream)[source.output]
      if (output == null) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Upstream node "${source.nodeId}" does not expose output "${source.output}".`, path, {
            nodeId: source.nodeId,
            output: source.output,
            variant: 'output',
          }),
        )
      } else if (
        targetInput != null &&
        ((!jsonEqual(output.jsonSchema, {}) && output.jsonSchema !== true && output.nullable && !targetInput.nullable) ||
          !schemaAssignable(output.jsonSchema, targetInput.jsonSchema))
      ) {
        diagnostics.push(
          graphDiagnostic(
            'graph.node-output-incompatible',
            `Upstream node "${source.nodeId}" output "${source.output}" is not compatible with this input.`,
            path,
            { nodeId: source.nodeId, output: source.output },
          ),
        )
      }
    }
  }
}

function nodeDependencies(graph: Graph, node: GraphNode): Set<string> {
  const dependencies = new Set<string>()
  if (!('inputs' in node)) return dependencies
  for (const mapping of Object.values(node.inputs)) {
    if (mapping.kind != 'sources') continue
    for (const source of mapping.sources) {
      if (source.kind == 'node' && graph.nodes[source.nodeId] != null) dependencies.add(source.nodeId)
    }
  }
  return dependencies
}

function checkCycles(graph: Graph, path: string, diagnostics: Diagnostic[]): void {
  const dependencies = new Map(Object.entries(graph.nodes).map(([nodeId, node]) => [nodeId, nodeDependencies(graph, node)]))
  while (dependencies.size > 0) {
    const ready = [...dependencies].filter(([, sources]) => sources.size == 0).map(([nodeId]) => nodeId)
    if (ready.length == 0) {
      const nodes = [...dependencies.keys()].toSorted().join(', ')
      diagnostics.push(graphDiagnostic('graph.cycle', `Graph contains a dependency cycle among nodes: ${nodes}.`, path, { nodes }))
      return
    }
    for (const nodeId of ready) dependencies.delete(nodeId)
    for (const sources of dependencies.values()) for (const nodeId of ready) sources.delete(nodeId)
  }
}

function validateGraph(
  graph: Graph,
  document: FlowDocument,
  flowInputs: ReadonlySet<string> | undefined,
  allowTriggers: boolean,
  path: string,
  diagnostics: Diagnostic[],
): void {
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const nodePath = `${path}/nodes/${nodeId}`
    if (!('inputs' in node)) {
      if (hasRetiredRef(triggerPayloadSchema(node))) {
        diagnostics.push(graphDiagnostic('graph.schema-unsupported', 'Runtime Ref schemas are not supported.', nodePath))
      }
      if (!allowTriggers) {
        diagnostics.push(graphDiagnostic('graph.trigger-not-allowed', 'Trigger nodes are only allowed in Flows.', nodePath))
      } else {
        validateTrigger(nodeId, node, document, nodePath, diagnostics)
      }
      continue
    }
    if (node.kind == 'task' && node.task == null && document.tasks[node.taskId] == null) {
      diagnostics.push(
        graphDiagnostic('graph.target-missing', `Task "${node.taskId}" does not exist.`, `${nodePath}/taskId`, {
          taskId: node.taskId,
          variant: 'task',
        }),
      )
    } else if (node.kind == 'subflow' && document.subflows[node.subflowId] == null) {
      diagnostics.push(
        graphDiagnostic('graph.target-missing', `Subflow "${node.subflowId}" does not exist.`, `${nodePath}/subflowId`, {
          subflowId: node.subflowId,
          variant: 'subflow',
        }),
      )
    }
    const inputPorts = nodeInputPorts(document, node)
    const ports = [...Object.values(inputPorts), ...Object.values(nodeOutputPorts(document, node))]
    if (ports.some((port) => hasRetiredRef(port.jsonSchema))) {
      diagnostics.push(graphDiagnostic('graph.schema-unsupported', 'Runtime Ref schemas are not supported.', nodePath))
    }
    const inputs = new Set(Object.keys(inputPorts))
    for (const [handle, mapping] of Object.entries(node.inputs)) {
      const mappingPath = `${nodePath}/inputs/${handle}`
      if (!inputs.has(handle)) {
        diagnostics.push(graphDiagnostic('graph.input-missing', `Node "${nodeId}" does not expose input "${handle}".`, mappingPath, { handle, nodeId }))
      }
      if (mapping.kind == 'sources') {
        const variableSources = mapping.sources.filter((source) => source.kind == 'binding' && document.bindings[source.bindingId]?.kind == 'variable')
        if (variableSources.length > 0 && (variableSources.length != 1 || mapping.sources.length != 1)) {
          diagnostics.push(graphDiagnostic('graph.variable-source-mixed', 'A Variable must be the only source for an input.', mappingPath))
        }
        for (const source of mapping.sources) checkSource(source, graph, document, flowInputs, inputPorts[handle], mappingPath, diagnostics)
      }
    }
    if (node.kind != 'condition') continue
    const outputs = new Set<string>()
    for (const [index, condition] of node.cases.entries()) {
      if (outputs.has(condition.output)) {
        diagnostics.push(
          graphDiagnostic(
            'condition.output-duplicate',
            `Condition output "${condition.output}" is declared more than once.`,
            `${nodePath}/cases/${index}/output`,
            { output: condition.output },
          ),
        )
      }
      outputs.add(condition.output)
      for (const [expressionIndex, expression] of condition.expressions.entries()) {
        if (expression.input == node.input.handle) continue
        diagnostics.push(
          graphDiagnostic(
            'condition.input-missing',
            `Condition expression references unknown input "${expression.input}".`,
            `${nodePath}/cases/${index}/expressions/${expressionIndex}/input`,
            { input: expression.input },
          ),
        )
      }
    }
  }
  checkCycles(graph, path, diagnostics)
}

function validateSubflowCycles(document: FlowDocument, diagnostics: Diagnostic[]): void {
  const visited = new Set<string>()
  const stack: string[] = []

  function visitGraph(graph: Graph, path: string): void {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.kind != 'subflow' || document.subflows[node.subflowId] == null) continue
      const cycle = stack.indexOf(node.subflowId)
      if (cycle >= 0) {
        const subflows = [...stack.slice(cycle), node.subflowId].join(' -> ')
        diagnostics.push(graphDiagnostic('subflow.cycle', `Subflow cycle is not executable: ${subflows}.`, `${path}/nodes/${nodeId}/subflowId`, { subflows }))
        continue
      }
      if (visited.has(node.subflowId)) continue
      visited.add(node.subflowId)
      stack.push(node.subflowId)
      visitGraph(document.subflows[node.subflowId].graph, `/document/subflows/${node.subflowId}/graph`)
      stack.pop()
    }
  }

  visitGraph(document.graph, '/document/graph')
}

function validateFlowGraph(revision: RevisionContent, closure: SemanticClosure): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const [bindingId, binding] of Object.entries(revision.document.bindings)) {
    if (binding.kind == 'variable' && !validVariableName(binding.target)) {
      diagnostics.push(
        graphDiagnostic('binding.variable-invalid', `Variable binding "${bindingId}" has an invalid target.`, `/document/bindings/${bindingId}/target`, {
          bindingId,
        }),
      )
    }
  }
  validateGraph(revision.document.graph, revision.document, undefined, true, '/document/graph', diagnostics)
  for (const subflowId of [...closure.dependencies.subflows].toSorted()) {
    const subflow = revision.document.subflows[subflowId]
    if (subflow == null) continue
    const path = `/document/subflows/${subflowId}`
    const inputs = new Set(subflow.inputs.map((input) => input.handle))
    validateGraph(subflow.graph, revision.document, inputs, false, `${path}/graph`, diagnostics)
    for (const output of subflow.outputs) {
      for (const source of output.sources)
        checkSource(source, subflow.graph, revision.document, inputs, undefined, `${path}/outputs/${output.handle}/sources`, diagnostics)
    }
  }
  validateSubflowCycles(revision.document, diagnostics)
  return diagnostics
}

export type FlowInputsValidation = 'invalid' | 'valid'

export function validateFlowInputs(revision: RevisionContent, value: unknown): FlowInputsValidation {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return 'invalid'
  const graph = revision.document.graph
  for (const [nodeId, candidate] of Object.entries(value)) {
    const node = graph.nodes[nodeId]
    if (node == null || !('inputs' in node) || candidate == null || typeof candidate != 'object' || Array.isArray(candidate)) {
      return 'invalid'
    }
    const inputs = nodeInputPorts(revision.document, node)
    for (const handle of Object.keys(candidate)) {
      const port = inputs[handle]
      if (port == null || hasRetiredRef(port.jsonSchema) || node.inputs[handle] != null || Object.hasOwn(port, 'value')) return 'invalid'
    }
  }
  return 'valid'
}

function validateModuleGraph(
  revision: RevisionContent,
  moduleIds: readonly string[],
  engine: EngineContract,
): { readonly analysis: ReadonlyMap<string, ModuleAnalysis>; readonly diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const analysis = new Map<string, ModuleAnalysis>()
  for (const moduleId of moduleIds.toSorted()) {
    const module = revision.modules[moduleId]
    if (module == null) continue
    const result = analyzeModule(moduleId, module.source, diagnostics)
    if (result != null) analysis.set(moduleId, result)
  }

  for (const moduleId of moduleIds.toSorted()) {
    const module = revision.modules[moduleId]
    if (module == null) continue
    const result = analysis.get(moduleId)
    if (result == null) continue
    const sourceImports = new Set<string>()
    for (const imported of result.imports) {
      if (imported.specifier == engine.platformModule) {
        for (const name of imported.imported) {
          if (engine.platformExports.has(name)) continue
          diagnostics.push({
            code: 'module.missing-export',
            column: imported.column,
            line: imported.line,
            message: `Platform Library does not export "${name}".`,
            path: modulePath(moduleId),
            values: { name, variant: 'platform' },
          })
        }
        continue
      }
      const importedModuleId = projectModule(imported.specifier)
      if (importedModuleId == null) {
        diagnostics.push({
          code: 'module.unsupported-import',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${moduleId}" cannot import "${imported.specifier}".`,
          path: modulePath(moduleId),
          values: { moduleId, specifier: imported.specifier, variant: 'import' },
        })
        continue
      }
      sourceImports.add(importedModuleId)
      if (revision.modules[importedModuleId] == null) {
        diagnostics.push({
          code: 'module.missing',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${importedModuleId}" does not exist.`,
          path: modulePath(moduleId),
          values: { moduleId: importedModuleId },
        })
        continue
      }
      if (!module.imports.includes(importedModuleId)) {
        diagnostics.push({
          code: 'module.import-not-declared',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${moduleId}" does not declare its import of "${importedModuleId}".`,
          path: modulePath(moduleId),
          values: { importedModuleId, moduleId },
        })
        continue
      }
      const importedAnalysis = analysis.get(importedModuleId)
      if (importedAnalysis == null) continue
      for (const name of imported.imported) {
        if (importedAnalysis.exports.has(name)) continue
        diagnostics.push({
          code: 'module.missing-export',
          column: imported.column,
          line: imported.line,
          message: `CodeModule "${importedModuleId}" does not export "${name}".`,
          path: modulePath(moduleId),
          values: { moduleId: importedModuleId, name, variant: 'module' },
        })
      }
    }
    for (const importedModuleId of module.imports) {
      if (sourceImports.has(importedModuleId)) continue
      diagnostics.push({
        code: 'module.declared-import-missing',
        column: 0,
        line: 1,
        message: `CodeModule "${moduleId}" declares "${importedModuleId}" without a matching static import.`,
        path: modulePath(moduleId),
        values: { importedModuleId, moduleId },
      })
    }
  }
  return { analysis, diagnostics }
}

export function validateModules(revision: RevisionContent, moduleIds: readonly string[], engine: EngineContract): readonly Diagnostic[] {
  return validateModuleGraph(revision, moduleIds, engine).diagnostics.toSorted(compareDiagnostics)
}

export async function validateFlow(revision: RevisionContent, engine: EngineContract): Promise<FlowValidation> {
  const closure = await flowClosure(revision)
  const checked = validateModuleGraph(revision, [...closure.dependencies.modules], engine)
  checked.diagnostics.push(...validateFlowGraph(revision, closure))
  const graphs = [
    ['/document/graph', revision.document.graph] as const,
    ...[...closure.dependencies.subflows].toSorted().flatMap((subflowId) => {
      const subflow = revision.document.subflows[subflowId]
      return subflow == null ? [] : [[`/document/subflows/${subflowId}/graph`, subflow.graph] as const]
    }),
  ]
  const missingEntryModules = new Set<string>()
  for (const [graphPath, graph] of graphs) {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.kind != 'task' || node.task == null) continue
      if (revision.modules[node.task.moduleId] == null) {
        checked.diagnostics.push({
          code: 'task.module-missing',
          column: 0,
          line: 1,
          message: `Inline Task "${nodeId}" references missing CodeModule "${node.task.moduleId}".`,
          path: `${graphPath}/nodes/${nodeId}/task/moduleId`,
          values: { moduleId: node.task.moduleId, nodeId },
        })
      } else if (!checked.analysis.get(node.task.moduleId)?.exports.has('default') && !missingEntryModules.has(node.task.moduleId)) {
        missingEntryModules.add(node.task.moduleId)
        checked.diagnostics.push({
          code: 'task.missing-entry',
          column: 0,
          line: 1,
          message: `CodeModule "${node.task.moduleId}" used by an Inline Task must export a default function.`,
          path: `/modules/${node.task.moduleId}/source`,
          values: { moduleId: node.task.moduleId },
        })
      }
      for (const [index, capability] of (node.task.capabilities ?? []).entries()) {
        if (capability.action.length > 0 && capability.connectionId.length > 0) continue
        checked.diagnostics.push({
          code: 'task.capability-incomplete',
          column: 0,
          line: 1,
          message: `Inline Task "${nodeId}" has an incomplete Connector Capability.`,
          path: `${graphPath}/nodes/${nodeId}/task/capabilities/${index}`,
          values: { nodeId },
        })
      }
    }
  }
  for (const taskId of [...closure.dependencies.tasks].toSorted()) {
    const task = revision.document.tasks[taskId]
    if (task == null) continue
    if (task.executor.kind == 'connector' && task.executor.action.length == 0) {
      checked.diagnostics.push({
        code: 'task.connector-incomplete',
        column: 0,
        line: 1,
        message: `Connector Task "${taskId}" requires an action.`,
        path: `/document/tasks/${taskId}/executor`,
        values: { taskId },
      })
    }
  }
  const diagnostics = checked.diagnostics.toSorted(compareDiagnostics)
  return { closure, diagnostics, valid: diagnostics.length == 0 }
}

export interface PreparedFlow {
  readonly closureDigest: string
  readonly engineContract: string
  readonly graph: Graph
  readonly modules: RevisionContent['modules']
  readonly subflows: FlowDocument['subflows']
  readonly tasks: FlowDocument['tasks']
}

export type PrepareFlowResult =
  | { readonly kind: 'engine-unsupported' }
  | { readonly kind: 'flow-invalid'; readonly validation: FlowValidation }
  | { readonly flow: PreparedFlow; readonly kind: 'prepared'; readonly validation: FlowValidation }

export async function prepareFlow(revision: RevisionContent, engineContract: string): Promise<PrepareFlowResult> {
  const engine = findEngineContract(engineContract)
  if (engine == null) return { kind: 'engine-unsupported' }
  const validation = await validateFlow(revision, engine)
  if (!validation.valid) return { kind: 'flow-invalid', validation }
  const { closure } = validation
  return {
    flow: {
      closureDigest: closure.digest,
      engineContract,
      graph: revision.document.graph,
      modules: Object.fromEntries([...closure.dependencies.modules].toSorted().map((id) => [id, revision.modules[id]!])),
      subflows: Object.fromEntries([...closure.dependencies.subflows].toSorted().map((id) => [id, revision.document.subflows[id]!])),
      tasks: Object.fromEntries([...closure.dependencies.tasks].toSorted().map((id) => [id, revision.document.tasks[id]!])),
    },
    kind: 'prepared',
    validation,
  }
}

export function createRuntimeProgram(prepared: PreparedFlow, entryModuleId: string, engineDigest: string): RuntimeProgram | undefined {
  if (!Object.hasOwn(prepared.modules, entryModuleId)) return
  return {
    engineContract: prepared.engineContract,
    engineDigest,
    entryModuleId,
    modules: prepared.modules,
  }
}
