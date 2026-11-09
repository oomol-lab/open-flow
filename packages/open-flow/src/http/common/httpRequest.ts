import type { InputMapping, InputPort, JsonValue, ManagedTaskDefinitionOf, TaskDefinitionBase } from '../../flow/common/model.ts'
import type { RequestTaskNode } from '../../flow/common/requestParameters.ts'

import { z } from 'zod'
import {
  requestParameterSchema,
  requestParameterPorts,
  requestParameterIssues,
  requestInputMappings,
  retainRequestPorts,
  withRequestParameterFields,
  withRequestParameterSource,
} from '../../flow/common/requestParameters.ts'
import { httpHeaderNameIssue } from './headers.ts'

export { httpHostAllowed, isHttpHost, maxHttpHosts } from './hosts.ts'

export const httpRequestConfigSchema = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
  query: requestParameterSchema.default({ mode: 'fields', names: [] }),
  headers: requestParameterSchema.default({ mode: 'fields', names: [] }),
  bodyFormat: z.enum(['none', 'json', 'text', 'form']).default('none'),
  authentication: z
    .union([
      z.strictObject({ type: z.literal('none') }),
      z.strictObject({ type: z.enum(['bearer', 'basic']) }),
      z.strictObject({ type: z.literal('apiKey'), name: z.string(), in: z.enum(['header', 'query']) }),
    ])
    .default({ type: 'none' }),
  responseFormat: z.enum(['auto', 'json', 'text']).default('auto'),
  statusPolicy: z.enum(['success', 'all']).default('success'),
})
export type HttpRequestConfig = z.infer<typeof httpRequestConfigSchema>
export interface HttpRequestExecutor extends HttpRequestConfig {
  readonly kind: 'http-request'
}
export const httpRequestExecutorSchema = httpRequestConfigSchema.extend({ kind: z.literal('http-request') })
const scalarSchema = { type: ['string', 'number', 'boolean'] }
const queryValueSchema = { anyOf: [scalarSchema, { type: 'array', items: scalarSchema }] }
export const httpHeaderSchema = { type: 'object', additionalProperties: { type: 'string' } }
export const httpQuerySchema = { type: 'object', additionalProperties: queryValueSchema }

export function httpAuthHandles(config: HttpRequestConfig): string[] {
  return config.authentication.type == 'none' ? [] : config.authentication.type == 'basic' ? ['auth.username', 'auth.password'] : ['auth.token']
}
export function httpRequestTask(
  config: HttpRequestConfig = httpRequestConfigSchema.parse({}),
  name = 'HTTP Request',
  previous?: TaskDefinitionBase,
): ManagedTaskDefinitionOf<HttpRequestExecutor> {
  const inputs: InputPort[] = [
    { handle: 'url', jsonSchema: { type: 'string' }, nullable: false },
    ...requestParameterPorts(config, httpQuerySchema, queryValueSchema, httpHeaderSchema),
  ]
  if (config.bodyFormat != 'none')
    inputs.push({
      handle: 'body',
      jsonSchema: config.bodyFormat == 'json' ? {} : config.bodyFormat == 'text' ? { type: 'string' } : httpQuerySchema,
      nullable: config.bodyFormat == 'json',
    })
  inputs.push(...httpAuthHandles(config).map((handle) => ({ handle, jsonSchema: { type: 'string' }, nullable: false })))
  const outputs: InputPort[] = [
    { handle: 'body', jsonSchema: config.responseFormat == 'text' ? { type: 'string' } : {}, nullable: true },
    { handle: 'statusCode', jsonSchema: { type: 'integer' }, nullable: false },
    { handle: 'headers', jsonSchema: httpHeaderSchema, nullable: false },
  ]

  return {
    name,
    executor: { ...config, kind: 'http-request' },
    inputs: retainRequestPorts(inputs, previous?.inputs),
    outputs: retainRequestPorts(outputs, previous?.outputs),
  }
}
export interface HttpRequestIssue {
  field: string
  index?: number
  code: 'bodyUnsupported' | 'parameterNamesInvalid' | 'headerNameInvalid' | 'keyNameRequired' | 'authConflict'
  message: string
}
export function httpRequestIssues(config: HttpRequestConfig): HttpRequestIssue[] {
  const issues: HttpRequestIssue[] = []
  if (['GET', 'HEAD'].includes(config.method) && config.bodyFormat != 'none')
    issues.push({ field: 'bodyFormat', code: 'bodyUnsupported', message: 'GET and HEAD do not support a request body.' })
  issues.push(...requestParameterIssues(config))
  const auth = config.authentication
  if (auth.type != 'none') {
    const group = auth.type == 'apiKey' && auth.in == 'query' ? 'query' : 'headers'
    const name = auth.type == 'apiKey' ? auth.name : 'authorization'
    if (!name.trim()) issues.push({ field: 'authentication', code: 'keyNameRequired', message: 'API Key requires a name.' })
    if (group == 'headers' && name.trim() && httpHeaderNameIssue(name, []) === 'invalid')
      issues.push({ field: 'authentication', code: 'headerNameInvalid', message: 'Invalid authentication header name.' })
    if (config[group].mode == 'fields' && config[group].names.some((item) => (group == 'headers' ? item.toLowerCase() == name.toLowerCase() : item == name)))
      issues.push({ field: 'authentication', code: 'authConflict', message: 'Authentication conflicts with a request parameter.' })
  }
  return issues
}
function entries(value: JsonValue | undefined): [string, JsonValue][] {
  if (value == null) return []
  if (typeof value != 'object' || Array.isArray(value)) throw new Error('Expected a parameter object.')
  return Object.entries(value)
}
function scalar(value: JsonValue): string {
  if (typeof value != 'string' && typeof value != 'number' && typeof value != 'boolean') throw new Error('Expected a scalar parameter.')
  return String(value)
}
function append(query: URLSearchParams, name: string, value: JsonValue): void {
  for (const item of Array.isArray(value) ? value : [value]) query.append(name, scalar(item))
}
export function httpRequestUrl(value: unknown): URL {
  if (typeof value != 'string' || !value.trim()) throw new Error('A URL is required.')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('An HTTP(S) URL without credentials is required.')
  return url
}
export function buildHttpRequest(config: HttpRequestConfig, input: Readonly<Record<string, JsonValue>>): { url: string; init: RequestInit } {
  if (httpRequestIssues(config).length) throw new Error('Invalid HTTP request configuration.')
  const url = httpRequestUrl(input.url)
  const parameters = (group: 'query' | 'headers') =>
    config[group].mode == 'object'
      ? entries(input[group])
      : config[group].names.flatMap((name): [string, JsonValue][] => {
          const value = input[`${group == 'query' ? 'query' : 'header'}.${name}`]
          return value == null ? [] : [[name, value]]
        })
  for (const [name, value] of parameters('query')) {
    url.searchParams.delete(name)
    append(url.searchParams, name, value)
  }
  const headers = new Headers()
  for (const [name, value] of parameters('headers')) {
    if (headers.has(name)) throw new Error('Duplicate HTTP header.')
    if (typeof value != 'string') throw new Error('HTTP headers require text values.')
    headers.set(name, value)
  }
  const auth = config.authentication
  const credential = (part: string) => {
    const value = input[`auth.${part}`]
    if (typeof value != 'string' || !value) throw new Error('Authentication source is required.')
    return value
  }
  if (auth.type != 'none') {
    const name = auth.type == 'apiKey' ? auth.name : 'authorization'
    if (auth.type == 'apiKey' && auth.in == 'query') {
      if (url.searchParams.has(name)) throw new Error('Authentication conflicts with a query parameter.')
      url.searchParams.set(name, credential('token'))
    } else {
      if (headers.has(name)) throw new Error('Authentication conflicts with a header.')
      if (auth.type == 'basic') {
        const username = credential('username')
        if (username.includes(':')) throw new Error('Basic username cannot contain a colon.')
        const bytes = new TextEncoder().encode(`${username}:${credential('password')}`)
        headers.set(name, `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`)
      } else headers.set(name, auth.type == 'bearer' ? `Bearer ${credential('token')}` : credential('token'))
    }
  }
  let body: string | undefined
  if (config.bodyFormat != 'none') {
    if (!Object.hasOwn(input, 'body')) throw new Error('Request body is unset.')
    let contentType: string
    if (config.bodyFormat == 'json') {
      body = JSON.stringify(input.body)
      contentType = 'application/json'
    } else if (config.bodyFormat == 'text') {
      if (typeof input.body != 'string') throw new Error('Text body requires a string.')
      body = input.body
      contentType = 'text/plain'
    } else {
      if (input.body == null) throw new Error('Form body requires an object.')
      const form = new URLSearchParams()
      for (const [name, value] of entries(input.body)) append(form, name, value)
      body = form.toString()
      contentType = 'application/x-www-form-urlencoded'
    }
    const supplied = headers.get('content-type')
    if (config.bodyFormat != 'text' && supplied != null && supplied.split(';')[0]!.trim().toLowerCase() != contentType)
      throw new Error('Content-Type conflicts with body format.')
    if (supplied == null) headers.set('content-type', contentType)
  }
  return { url: url.href, init: { method: config.method, headers, body, redirect: 'manual' } }
}
export function parseHttpResponse(config: HttpRequestConfig, status: number, headers: Headers, text: string): Record<string, JsonValue> {
  if (config.statusPolicy == 'success' && (status < 200 || status >= 300)) throw new Error(`HTTP ${status}`)
  let body: JsonValue = null
  if (text && config.method != 'HEAD' && ![204, 205, 304].includes(status)) {
    const media = (headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    body =
      config.responseFormat == 'json' || (config.responseFormat == 'auto' && /^application\/(json|.+\+json)$/.test(media))
        ? (JSON.parse(text) as JsonValue)
        : text
  }
  return { body, statusCode: status, headers: Object.fromEntries([...headers].filter(([name]) => name != 'set-cookie')) }
}

/** Only a named parameter rename carries a value; changing source modes is not a rename. */
export const httpRequestInputs = requestInputMappings

function httpRequestExecutor(node: RequestTaskNode): HttpRequestExecutor | undefined {
  const executor = node.task.executor
  return executor?.kind === 'http-request' ? (executor as HttpRequestExecutor) : undefined
}

/** The object editor assembles named inputs without changing unrelated request settings. */
export function withHttpParameterFields<Node extends RequestTaskNode>(node: Node, group: 'query' | 'headers', values: Record<string, JsonValue>): Node {
  const config = httpRequestExecutor(node)
  if (config == null) return node
  return withRequestParameterFields(node, group, values, config[group], (parameters) =>
    httpRequestTask({ ...config, [group]: parameters }, node.task.name, node.task),
  )
}

export function withHttpParameterSource<Node extends RequestTaskNode>(node: Node, group: 'query' | 'headers', mapping?: InputMapping): Node {
  const config = httpRequestExecutor(node)
  if (config == null) return node
  return withRequestParameterSource(node, group, mapping, (parameters) => httpRequestTask({ ...config, [group]: parameters }, node.task.name, node.task))
}
