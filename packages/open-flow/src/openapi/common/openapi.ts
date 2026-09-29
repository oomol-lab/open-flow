import type { InputPort, JsonValue, ManagedTaskDefinition, Port } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { matchesSchema } from '../../flow/common/schema.ts'

type ObjectValue = { [key: string]: JsonValue }
export interface OpenApiAuth {
  readonly id: string
  readonly type: 'bearer' | 'basic' | 'apiKey'
  readonly name?: string
  readonly in?: 'header' | 'query'
}
export interface OpenApiExecutor {
  readonly kind: 'openapi'
  readonly sourceUrl: string
  readonly method: string
  readonly path: string
  readonly serverUrl: string
  readonly document: JsonValue
  readonly auth: readonly OpenApiAuth[]
}
export interface OpenApiOperation {
  readonly method: string
  readonly path: string
  readonly label: string
  readonly tag: string
}
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
export function object(value: unknown): ObjectValue {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new Error('Expected an OpenAPI object.')
  return value as ObjectValue
}
export function httpUrl(value: string, base?: string): string {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('An HTTP(S) URL without credentials or fragment is required.')
  return url.href
}
export function parseOpenApi(value: unknown): ObjectValue {
  const doc = object(value)
  if (typeof doc.openapi != 'string' || !/^3\.[01]\.\d+$/.test(doc.openapi)) throw new Error('Only OpenAPI 3.0 and 3.1 JSON documents are supported.')
  object(doc.paths)
  return doc
}
function pointer(doc: ObjectValue, ref: string): JsonValue {
  if (!ref.startsWith('#/')) throw new Error('External OpenAPI references are not supported.')
  let value: JsonValue = doc
  for (const key of decodeURIComponent(ref.slice(2))
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    const source = object(value)
    if (!Object.hasOwn(source, key)) throw new Error('An OpenAPI reference is missing.')
    value = source[key]!
  }
  return value
}
function resolved(doc: ObjectValue, value: JsonValue): ObjectValue {
  let result = object(value)
  const seen = new Set<string>()
  while (typeof result.$ref == 'string') {
    if (seen.has(result.$ref)) throw new Error('Circular non-schema reference is unsupported.')
    seen.add(result.$ref)
    const { $ref, ...siblings } = result
    result = { ...object(pointer(doc, $ref)), ...siblings }
  }
  return result
}
export function listOperations(documentValue: JsonValue): OpenApiOperation[] {
  const doc = parseOpenApi(documentValue)
  return Object.entries(object(doc.paths)).flatMap(([path, value]) => {
    const item = resolved(doc, value)
    return methods
      .filter((method) => item[method] != null)
      .map((method) => {
        const op = object(item[method])
        return {
          method,
          path,
          label: String(op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`),
          tag: String((op.tags as JsonValue[] | undefined)?.[0] ?? ''),
        }
      })
  })
}
function operation(doc: ObjectValue, path: string, method: string): { item: ObjectValue; op: ObjectValue } {
  const item = resolved(doc, object(doc.paths)[path]!)
  if (!methods.includes(method) || item[method] == null) throw new Error('The selected operation is no longer available.')
  return { item, op: object(item[method]) }
}
export function servers(value: JsonValue, path: string, method: string): readonly ObjectValue[] {
  const doc = parseOpenApi(value)
  const { item, op } = operation(doc, path, method)
  const entries = op.servers ?? item.servers ?? doc.servers
  if (!Array.isArray(entries) || entries.length == 0) return [{ url: '/' }]
  return entries.map(object)
}
export function serverAddress(server: ObjectValue, sourceUrl: string, variables: Readonly<Record<string, string>> = {}): string {
  return httpUrl(
    String(server.url).replace(/\{([^}]+)\}/g, (_, name: string) => {
      const definition = object(object(server.variables)[name])
      const value = variables[name] ?? definition.default
      if (typeof value != 'string' || (Array.isArray(definition.enum) && !definition.enum.includes(value))) throw new Error('A server variable is invalid.')
      return value
    }),
    sourceUrl,
  )
}
export function securityOptions(value: JsonValue, path: string, method: string): readonly { label: string; auth?: readonly OpenApiAuth[]; error?: string }[] {
  const doc = parseOpenApi(value)
  const { op } = operation(doc, path, method)
  const requirements = op.security ?? doc.security ?? []
  if (!Array.isArray(requirements)) throw new Error('Invalid security requirements.')
  if (!requirements.length) return [{ label: 'None', auth: [] }]
  return requirements.map((entry) => {
    const names = Object.keys(object(entry))
    const label = names.join(' + ') || 'None'
    try {
      if (!names.length) return { label, auth: [] }
      const schemes = object(object(doc.components).securitySchemes)
      return {
        label,
        auth: names.map((id): OpenApiAuth => {
          const scheme = resolved(doc, schemes[id]!)
          if (scheme.type == 'http' && ['bearer', 'basic'].includes(String(scheme.scheme).toLowerCase()))
            return { id, type: String(scheme.scheme).toLowerCase() as 'bearer' | 'basic' }
          if (scheme.type == 'apiKey' && (scheme.in == 'header' || scheme.in == 'query') && typeof scheme.name == 'string')
            return { id, type: 'apiKey', name: scheme.name, in: scheme.in }
          throw new Error('This security scheme is unsupported. Supply an access token using manual Bearer authentication if applicable.')
        }),
      }
    } catch (error) {
      return { label, error: (error as Error).message }
    }
  })
}
// The miniature document retains only the selected operation and reachable references.
export function snapshot(documentValue: JsonValue, path: string, method: string): JsonValue {
  const doc = parseOpenApi(documentValue)
  const { item, op } = operation(doc, path, method)
  const security = op.security ?? doc.security ?? []
  const result: ObjectValue = {
    openapi: doc.openapi!,
    paths: { [path]: { [method]: op, ...(item.parameters == null ? {} : { parameters: item.parameters }) } },
    servers: servers(doc, path, method) as JsonValue,
    security,
  }
  const visited = new Set<string>()
  function copy(ref: string): void {
    if (visited.has(ref)) return
    visited.add(ref)
    const value = pointer(doc, ref)
    const keys = decodeURIComponent(ref.slice(2))
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Unsupported reference key.')
    let target = result
    for (const key of keys.slice(0, -1)) {
      if (!Object.hasOwn(target, key)) target[key] = {}
      target = object(target[key])
    }
    target[keys.at(-1)!] = structuredClone(value)
    visit(value)
  }
  function visit(value: JsonValue): void {
    if (value == null || typeof value != 'object') return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof object(value).$ref == 'string') copy(object(value).$ref as string)
    for (const [key, child] of Object.entries(value)) if (!['example', 'examples', 'default'].includes(key)) visit(child)
  }
  visit(result)
  for (const entry of security as JsonValue[])
    for (const name of Object.keys(object(entry))) copy(`#/components/securitySchemes/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`)
  return structuredClone(result)
}
function schema(doc: ObjectValue, schemaValue: JsonValue): JsonValue {
  const defs: ObjectValue = {}
  const ids = new Map<string, string>()
  function convert(value: JsonValue): JsonValue {
    if (typeof value == 'boolean') return value
    const source = object(value)
    if (source.format == 'binary' || source.$dynamicRef != null || source.$id != null) throw new Error('Binary and dynamically scoped schemas are unsupported.')
    const result: ObjectValue = {}
    for (const [key, child] of Object.entries(source)) {
      if (['nullable', 'example', 'xml', 'discriminator', '__proto__'].includes(key)) continue
      if (key == '$ref') {
        if (typeof child != 'string') throw new Error('Invalid schema reference.')
        let id = ids.get(child)
        if (id == null) {
          id = `s${ids.size}`
          ids.set(child, id)
          defs[id] = convert(pointer(doc, child))
        }
        result.$ref = `#/$defs/${id}`
      } else if (['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(key)) {
        result[key] = Object.fromEntries(Object.entries(object(child)).map(([name, childSchema]) => [name, convert(childSchema)]))
      } else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key)) {
        if (!Array.isArray(child)) throw new Error('Invalid schema composition.')
        result[key] = child.map(convert)
      } else if (['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedProperties'].includes(key))
        result[key] = convert(child)
      else result[key] = child
    }
    if (source.nullable === true) return { anyOf: [result, { type: 'null' }] }
    for (const key of ['minimum', 'maximum']) {
      const exclusive = key == 'minimum' ? 'exclusiveMinimum' : 'exclusiveMaximum'
      if (typeof result[exclusive] == 'boolean') {
        if (result[exclusive] && typeof result[key] == 'number') {
          result[exclusive] = result[key]!
          delete result[key]
        } else delete result[exclusive]
      }
    }
    return result
  }
  let converted = convert(schemaValue)
  if (typeof converted == 'object' && converted != null && typeof object(converted).$ref == 'string') {
    const id = String(object(converted).$ref).slice('#/$defs/'.length)
    const { $ref: _ref, ...siblings } = object(converted)
    converted = { ...object(defs[id]), ...siblings }
  }
  if (typeof converted == 'boolean') return converted
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...object(converted), ...(Object.keys(defs).length ? { $defs: defs } : {}) }
}
function parameters(config: OpenApiExecutor): ObjectValue[] {
  const doc = parseOpenApi(config.document)
  const { item, op } = operation(doc, config.path, config.method)
  const entries = new Map<string, ObjectValue>()
  for (const value of [...((item.parameters as JsonValue[]) ?? []), ...((op.parameters as JsonValue[]) ?? [])]) {
    const p = resolved(doc, value)
    if (!['path', 'query', 'header'].includes(String(p.in)) || typeof p.name != 'string' || p.content != null)
      throw new Error('Only schema-based path, query and header parameters are supported.')
    if (p.allowReserved === true) throw new Error('allowReserved parameters are unsupported.')
    const style = p.style ?? (p.in == 'query' ? 'form' : 'simple')
    if (style != (p.in == 'query' ? 'form' : 'simple')) throw new Error('Only form query and simple path/header serialization are supported.')
    entries.set(`${p.in}.${p.in == 'header' ? p.name.toLowerCase() : p.name}`, p)
  }
  return [...entries.values()]
}
function jsonContent(doc: ObjectValue, value: JsonValue): { schema: JsonValue; required: boolean; mediaType: string } {
  const content = resolved(doc, value)
  const media = object(content.content)
  const mediaType = media['application/json'] != null ? 'application/json' : Object.keys(media).find((key) => /^application\/.+\+json$/.test(key))
  const json = mediaType == null ? undefined : media[mediaType]
  if (json == null) throw new Error('Only JSON request and response bodies are supported.')
  return { schema: schema(doc, object(json).schema ?? {}), required: content.required === true, mediaType: mediaType! }
}
export function authHandles(auth: readonly OpenApiAuth[]): string[] {
  return auth.flatMap((scheme) => (scheme.type == 'basic' ? [`auth.${scheme.id}.username`, `auth.${scheme.id}.password`] : [`auth.${scheme.id}.token`]))
}
export function openApiTask(config: OpenApiExecutor, name = 'OpenAPI'): ManagedTaskDefinition {
  if (!config.path) return { name, executor: config, inputs: [], outputs: [] }
  const doc = parseOpenApi(config.document)
  const { op } = operation(doc, config.path, config.method)
  const params = parameters(config)
  const inputs: InputPort[] = params.map((p) => {
    const jsonSchema = schema(doc, p.schema ?? {})
    const defaultValue = typeof jsonSchema == 'boolean' ? undefined : object(jsonSchema).default
    return {
      handle: `${p.in}.${p.name}`,
      jsonSchema,
      nullable: (p.required !== true && p.in != 'path') || matchesSchema(null, jsonSchema),
      ...(typeof p.description == 'string' ? { description: p.description } : {}),
      ...(defaultValue === undefined ? {} : { value: defaultValue }),
    }
  })
  if (op.requestBody != null) {
    if (config.method == 'get' || config.method == 'head') throw new Error('GET and HEAD request bodies are unsupported.')
    const body = jsonContent(doc, op.requestBody)
    inputs.push({ handle: 'body', jsonSchema: body.schema, nullable: !body.required || matchesSchema(null, body.schema) })
  }
  const occupied = new Set(params.map((p) => `${p.in}.${p.in == 'header' ? String(p.name).toLowerCase() : p.name}`))
  for (const auth of config.auth) {
    const location = auth.type == 'apiKey' ? `${auth.in}.${auth.in == 'header' ? auth.name?.toLowerCase() : auth.name}` : 'header.authorization'
    if (occupied.has(location)) throw new Error('Authentication conflicts with a parameter or another security scheme.')
    if (auth.type == 'apiKey' && (!auth.name || !['header', 'query'].includes(auth.in ?? ''))) throw new Error('API Key requires a name and location.')
    occupied.add(location)
  }
  inputs.push(...authHandles(config.auth).map((handle) => ({ handle, jsonSchema: { type: 'string' }, nullable: false })))
  const responses = object(op.responses)
  const schemas: JsonValue[] = []
  for (const [status, response] of Object.entries(responses))
    if (/^2\d\d$|^2XX$/.test(status) || status == 'default') {
      const r = resolved(doc, response)
      if (r.content == null) schemas.push({ type: 'null' })
      else {
        jsonContent(doc, r)
        for (const [mediaType, media] of Object.entries(object(r.content)))
          if (/^application\/(json|.+\+json)$/.test(mediaType)) schemas.push(schema(doc, object(media).schema ?? {}))
      }
    }
  if (!schemas.length) throw new Error('A successful JSON response definition is required.')
  // Each branch keeps its own reference scope when compiled separately at execution.
  const bodySchema =
    schemas.length == 1 ? schemas[0]! : { $schema: 'https://json-schema.org/draft/2020-12/schema', anyOf: schemas.map((s, index) => inlineSchema(s, index)) }
  const outputs: Port[] = [
    { handle: 'body', jsonSchema: bodySchema, nullable: config.method == 'head' || schemas.some((item) => matchesSchema(null, item)) },
    { handle: 'statusCode', jsonSchema: { type: 'integer' }, nullable: false },
    { handle: 'headers', jsonSchema: { type: 'object', additionalProperties: { type: 'string' } }, nullable: false },
  ]
  return { name, executor: config, inputs, outputs }
}
function inlineSchema(value: JsonValue, index: number): JsonValue {
  if (Array.isArray(value)) return value.map((item) => inlineSchema(item, index))
  if (value == null || typeof value != 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key == '$ref' && typeof child == 'string' && child.startsWith('#/') ? `#/anyOf/${index}/${child.slice(2)}` : inlineSchema(child, index),
    ]),
  )
}
export interface OpenApiFieldIssue {
  readonly field: 'sourceUrl' | 'operation' | 'serverUrl'
  readonly message: string
}

/** The canvas validator and property panel share the same configuration contract. */
export function openApiFieldIssues(task: ManagedTaskDefinition): OpenApiFieldIssue[] {
  if (task.executor.kind != 'openapi') return []
  const config = task.executor
  let field: OpenApiFieldIssue['field'] = 'sourceUrl'
  try {
    if (!config.sourceUrl.trim()) return [{ field, message: 'Enter an OpenAPI JSON document URL.' }]
    httpUrl(config.sourceUrl)
    field = 'operation'
    if (!config.path) return [{ field, message: 'Select an OpenAPI operation.' }]
    field = 'serverUrl'
    httpUrl(config.serverUrl)
    if (new URL(config.serverUrl).search) throw new Error('Server URLs must not contain a query string.')
    field = 'operation'
    if (!dequal(config.document, snapshot(config.document, config.path, config.method)))
      return [{ field, message: 'Save only the selected operation and its dependencies.' }]
    const expected = openApiTask(config, task.name)
    if (!dequal(expected.inputs, task.inputs) || !dequal(expected.outputs, task.outputs))
      return [{ field, message: 'OpenAPI ports must match the saved operation.' }]
    return []
  } catch (error) {
    return [{ field, message: (error as Error).message }]
  }
}

export function openApiIssues(task: ManagedTaskDefinition): string[] {
  return openApiFieldIssues(task).map((issue) => issue.message)
}
export function selectOperation(value: JsonValue, sourceUrl: string, path: string, method: string): OpenApiExecutor {
  const doc = snapshot(value, path, method)
  const choices = securityOptions(doc, path, method)
  const auth = choices.find((choice) => choice.auth != null)?.auth
  if (auth == null) throw new Error(choices[0]?.error ?? 'Unsupported authentication.')
  const config: OpenApiExecutor = {
    kind: 'openapi',
    sourceUrl: httpUrl(sourceUrl),
    method,
    path,
    serverUrl: serverAddress(servers(doc, path, method)[0]!, sourceUrl),
    document: doc,
    auth,
  }
  openApiTask(config)
  return config
}
function scalar(v: JsonValue): string {
  if (v != null && typeof v == 'object') throw new Error('Nested parameter values are unsupported.')
  return v == null ? '' : String(v)
}
export function buildRequest(config: OpenApiExecutor, input: Readonly<Record<string, JsonValue>>): { url: string; init: RequestInit } {
  const task = openApiTask(config)
  for (const port of task.inputs) {
    if (!('handle' in port)) continue
    const value = input[port.handle]
    if (value === undefined) {
      if (!port.nullable) throw new Error('A required input is missing.')
      continue
    }
    if (!matchesSchema(value, port.jsonSchema)) throw new Error('A request input does not match its schema.')
  }
  let path = config.path
  const query = new URLSearchParams()
  const headers = new Headers({ accept: 'application/json' })

  for (const p of parameters(config)) {
    const value = input[`${p.in}.${p.name}`]
    if (value === undefined) {
      if (p.required === true || p.in == 'path') throw new Error('A required request parameter is missing.')
      continue
    }
    const explode = p.explode ?? p.in == 'query'
    const parts = Array.isArray(value)
      ? value.map(scalar)
      : value != null && typeof value == 'object'
        ? Object.entries(value).flatMap(([k, v]) => (explode ? [`${k}=${scalar(v)}`] : [k, scalar(v)]))
        : [scalar(value)]
    if (p.in == 'path') {
      const encoded =
        value != null && typeof value == 'object' && !Array.isArray(value) && explode
          ? Object.entries(value)
              .map(([key, entry]) => `${encodeURIComponent(key)}=${encodeURIComponent(scalar(entry))}`)
              .join(',')
          : parts.map(encodeURIComponent).join(',')
      path = path.replaceAll(`{${p.name}}`, encoded)
    } else if (p.in == 'header') headers.set(String(p.name), parts.join(','))
    else if (Array.isArray(value) && explode) for (const part of parts) query.append(String(p.name), part)
    else if (value != null && typeof value == 'object' && !Array.isArray(value) && explode)
      for (const [k, v] of Object.entries(value)) query.append(k, scalar(v))
    else query.append(String(p.name), parts.join(','))
  }
  if (/\{[^}]+\}/.test(path)) throw new Error('A path parameter is missing.')
  const url = new URL(httpUrl(config.serverUrl).replace(/\/$/, '') + '/' + path.replace(/^\//, ''))
  for (const [key, value] of query) url.searchParams.append(key, value)
  for (const auth of config.auth) {
    const token = (part: string): string => {
      const value = input[`auth.${auth.id}.${part}`]
      if (typeof value != 'string' || !value) throw new Error('Authentication source is missing.')
      return value
    }
    if (auth.type == 'bearer') headers.set('authorization', `Bearer ${token('token')}`)
    else if (auth.type == 'basic') {
      const username = token('username')
      if (username.includes(':')) throw new Error('Basic authentication username cannot contain a colon.')
      const bytes = new TextEncoder().encode(`${username}:${token('password')}`)
      headers.set('authorization', `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`)
    } else if (auth.in == 'header') headers.set(auth.name!, token('token'))
    else {
      if (url.searchParams.has(auth.name!)) throw new Error('Authentication conflicts with a query parameter.')
      url.searchParams.set(auth.name!, token('token'))
    }
  }
  const { op } = operation(parseOpenApi(config.document), config.path, config.method)
  let body: string | undefined
  if (op.requestBody != null && input.body !== undefined) {
    body = JSON.stringify(input.body)
    headers.set('content-type', jsonContent(parseOpenApi(config.document), op.requestBody).mediaType)
  } else if (op.requestBody != null && jsonContent(parseOpenApi(config.document), op.requestBody).required) throw new Error('The request body is required.')
  return { url: url.href, init: { method: config.method.toUpperCase(), headers, body, redirect: 'manual' } }
}
export function parseResponse(config: OpenApiExecutor, status: number, headers: Headers, text: string): Record<string, JsonValue> {
  if (status < 200 || status >= 300) throw new Error(`API request failed with HTTP ${status}.`)
  const doc = parseOpenApi(config.document)
  const responses = object(operation(doc, config.path, config.method).op.responses)
  const raw = responses[String(status)] ?? responses['2XX'] ?? responses.default
  if (raw == null) throw new Error('The response status is not declared in the saved definition.')
  const response = resolved(doc, raw)
  let body: JsonValue = null
  if (text && config.method != 'head' && status != 204 && status != 205) {
    const type = (headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    const media = object(response.content)[type]
    if (media == null || !/^application\/(json|.+\+json)$/.test(type)) throw new Error('The response media type is not supported by the saved definition.')
    try {
      body = JSON.parse(text) as JsonValue
    } catch {
      throw new Error('The API returned invalid JSON.')
    }
    if (!matchesSchema(body, schema(doc, object(media).schema ?? {}))) throw new Error('The API response does not match the saved schema.')
  } else if (response.content != null && config.method != 'head' && status != 204 && status != 205) throw new Error('The API returned an empty JSON response.')
  return { body, statusCode: status, headers: Object.fromEntries([...headers].filter(([name]) => name != 'set-cookie')) }
}
