import type { JsonValue } from '../../flow/common/model.ts'
import type { WebhookMethod } from '../../flow/common/webhookMethod.ts'
import type { WebhookAuthentication, WebhookBodyField, WebhookOptions } from './model.ts'

import { dequal } from 'dequal/lite'
import { isJsonObject } from '../../base/common/json.ts'
import { validWebhookStatus, webhookArtifactId, webhookHeaderValues, encodeWebhookBody } from '../../flow/common/webhookResponse.ts'
import { httpHeaderNameIssue } from '../../http/common/headers.ts'

export { webhookSupportsBody } from './contract.ts'
export { webhookResponseAllowsBody, webhookResponseTimeout } from '../../flow/common/webhookResponse.ts'

export type { WebhookResponseSnapshot } from '../../flow/common/webhookResponse.ts'
export {
  isWebhookFormContentType,
  renderWebhookFormPage,
  webhookFormBody,
  webhookFormControl,
  WebhookFormInvalid,
  webhookFormIssues,
  webhookFormLimits,
  webhookFormPageHeaders,
} from './webhookForm.ts'
export type { WebhookFormControl, WebhookFormIssue } from './webhookForm.ts'

export const maximumWebhookBodyBytes = 64 * 1024

/** Serialize only declared workflow business outputs, never node logs or execution metadata. */
export function webhookResponseBody(
  result: unknown,
  source: Extract<NonNullable<WebhookOptions['responseBody']>, { kind: 'workflow-outputs' }>,
): { readonly body: string; readonly contentType: string } | undefined {
  const value = workflowOutputValue(result, source.output)
  if (value === undefined) return
  return encodeWebhookBody(value)
}

/** The Run Artifact an Artifact-mode workflow-output response sends, or undefined when the output is not one. */
export function webhookResponseArtifactId(
  result: unknown,
  source: Extract<NonNullable<WebhookOptions['responseBody']>, { kind: 'workflow-outputs' }>,
): string | undefined {
  return source.output == null ? undefined : webhookArtifactId(workflowOutputValue(result, source.output))
}

export function webhookResponseStatusCode(result: unknown, output: string): number | undefined {
  const value = workflowOutputValue(result, output)
  if (validWebhookStatus(value)) return value
}

/** Project business headers before the HTTP layer applies its deployment-owned header policy. */
export function webhookResponseHeaders(result: unknown, options: WebhookOptions): Readonly<Record<string, string>> | undefined {
  const whole = options.responseHeadersSource
  const source = whole == null ? (options.responseHeaders ?? {}) : workflowOutputValue(result, whole.output)
  if (!isJsonObject(source)) return
  const values = new Map<string, { name: string; value: unknown }>()
  for (const [name, value] of Object.entries(source)) {
    if (
      httpHeaderNameIssue(
        name,
        [...values.values()].map((entry) => entry.name),
      ) != null
    )
      return
    values.set(name.toLowerCase(), { name, value })
  }
  if (whole == null) {
    const names: string[] = []
    for (const [name, output] of Object.entries(options.responseHeaderOutputs ?? {})) {
      if (httpHeaderNameIssue(name, names) != null) return
      names.push(name)
      values.set(name.toLowerCase(), { name, value: workflowOutputValue(result, output) })
    }
  }
  return webhookHeaderValues(Object.fromEntries([...values.values()].map(({ name, value }) => [name, value])))
}

function workflowOutputValue(result: unknown, output?: string): JsonValue | undefined {
  if (!isJsonObject(result) || result.kind != 'node-results' || !isJsonObject(result.outputs)) return
  return output == null ? result.outputs : Object.hasOwn(result.outputs, output) ? result.outputs[output] : undefined
}

/** Flow document bindings by identity, as stored in Revision content. */
export type WebhookBindings = Readonly<Record<string, { readonly kind: 'variable'; readonly target: string }>>

/** The Variable name holding the authentication secret, or undefined when the binding is not a Variable. */
export function webhookAuthenticationVariable(bindings: WebhookBindings, authentication: WebhookAuthentication): string | undefined {
  const binding = bindings[authentication.secret.bindingId]
  return binding?.kind == 'variable' ? binding.target : undefined
}

/** The request header that carries the credential for an authentication policy. */
export function webhookAuthenticationHeader(authentication: WebhookAuthentication): string {
  return authentication.type == 'bearer' ? 'authorization' : authentication.name.toLowerCase()
}

/**
 * Check a request against the Webhook authentication policy. Comparison runs over SHA-256 digests in constant time so
 * the response time does not reveal how much of the credential matched. An empty secret never authenticates.
 */
export async function verifyWebhookAuthentication(headers: Headers, authentication: WebhookAuthentication, secret: string): Promise<boolean> {
  if (secret.length == 0) return false
  const value = headers.get(webhookAuthenticationHeader(authentication))
  if (value == null) return false
  const credential = authentication.type == 'bearer' ? bearerToken(value) : value
  if (credential == null) return false
  const [actual, expected] = await Promise.all([digest(credential), digest(secret)])
  let difference = 0
  for (let index = 0; index < expected.length; index++) difference |= actual[index]! ^ expected[index]!
  return difference == 0
}

/**
 * Request headers exposed to the Run. The authentication credential header is never stored with Run outputs. A hosted
 * form is posted by a browser from the endpoint's own origin, which attaches that origin's cookies and cached
 * credentials, so a form endpoint never stores `cookie` or `authorization`.
 */
export function webhookOutputHeaders(headers: Headers, options: WebhookOptions | undefined): Readonly<Record<string, string>> {
  const values = Object.fromEntries(headers)
  if (options?.authentication != null) delete values[webhookAuthenticationHeader(options.authentication)]
  if (options?.form != null) {
    delete values.cookie
    delete values.authorization
  }
  return values
}

function bearerToken(value: string): string | undefined {
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(value)
  return match?.[1]
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

const endpointPattern = /^\/v1\/webhooks\/(endpoint_[0-9a-f]{32})$/
const encoder = new TextEncoder()

export function webhookEndpointId(url: URL): string | undefined {
  return endpointPattern.exec(url.pathname)?.[1]
}

export async function webhookOccurrenceId(endpointId: string, runtimeVersion: number, key: string | null): Promise<string | undefined> {
  if (key == null) return `webhook_${crypto.randomUUID().replaceAll('-', '')}`
  if (key.trim().length == 0 || key.length > 256) return
  const source = JSON.stringify([2, 'webhook-occurrence', endpointId, runtimeVersion, key])
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface WebhookConformanceFixture {
  /** Flow document bindings, such as the Variable binding an authentication policy references. */
  readonly bindings?: WebhookBindings
  readonly bodyFields: readonly WebhookBodyField[]
  readonly method: WebhookMethod
  readonly options?: WebhookOptions
  /** Variable values the Flow owner holds before the first publication. */
  readonly variables?: Readonly<Record<string, string>>
}

export interface WebhookConformanceHarness {
  readonly endpointUrl: string
  dispose(): Promise<void>
  outputs(): Promise<readonly Readonly<Record<string, JsonValue>>[]>
  republish(): Promise<void>
  request(request: Request): Promise<Response>
  retire(): Promise<void>
}

export interface WebhookConformanceCase {
  readonly fixture: WebhookConformanceFixture
  readonly name: string
  verify(harness: WebhookConformanceHarness): Promise<void>
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!dequal(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}

async function response(
  actual: Response,
  expected: { readonly body?: string; readonly headers?: Readonly<Record<string, string | null>>; readonly status: number },
  message: string,
): Promise<void> {
  equal(actual.status, expected.status, `${message} status`)
  if (expected.body != null) equal(await actual.text(), expected.body, `${message} body`)
  for (const [name, value] of Object.entries(expected.headers ?? {})) equal(actual.headers.get(name), value, `${message} header ${name}`)
}

function call(
  harness: WebhookConformanceHarness,
  input: { readonly body?: string; readonly headers?: Headers | Readonly<Record<string, string>>; readonly method?: string; readonly url?: string } = {},
): Promise<Response> {
  return harness.request(
    new Request(input.url ?? harness.endpointUrl, {
      ...(input.body == null ? {} : { body: input.body }),
      headers: input.headers,
      method: input.method ?? 'POST',
    }),
  )
}

const noInputs: readonly WebhookBodyField[] = []
const messageInputs: readonly WebhookBodyField[] = [
  {
    handle: 'event',
    jsonSchema: {
      additionalProperties: false,
      properties: { message: { type: 'string' } },
      required: ['message'],
      type: 'object',
    },
    nullable: false,
  },
]

const messagePayload = { event: { message: 'hello' } } as const
const formInputs: readonly WebhookBodyField[] = [
  { handle: 'name', jsonSchema: { type: 'string' }, nullable: false },
  { handle: 'count', jsonSchema: { type: 'integer' }, nullable: true },
  { handle: 'subscribe', jsonSchema: { type: 'boolean' }, nullable: true },
  { handle: 'plan', jsonSchema: { enum: ['free', 'pro'], type: 'string' }, nullable: true },
]

const secretBinding = { secret: { kind: 'variable', target: 'WEBHOOK_SECRET' } } as const
const secretValue = 'conformance-secret-value'

export const webhookConformanceCases: readonly WebhookConformanceCase[] = [
  {
    fixture: {
      bindings: secretBinding,
      bodyFields: noInputs,
      method: 'POST',
      options: { authentication: { secret: { bindingId: 'secret', kind: 'binding' }, type: 'bearer' } },
      variables: { WEBHOOK_SECRET: secretValue },
    },
    name: 'rejects requests without the bearer secret before admission and hides the credential',
    async verify(harness) {
      const challenge = { body: '', headers: { 'www-authenticate': 'Bearer' }, status: 401 }
      await response(await call(harness), challenge, 'Missing credential')
      await response(await call(harness, { headers: { Authorization: 'Bearer wrong' } }), challenge, 'Wrong credential')
      await response(await call(harness, { headers: { Authorization: `Basic ${secretValue}` } }), challenge, 'Wrong scheme')
      await response(await call(harness, { headers: { Authorization: `Bearer ${secretValue}x` } }), challenge, 'Credential with suffix')
      equal(await harness.outputs(), [], 'Rejected requests admit no Run')
      await response(
        await call(harness, { headers: { 'Authorization': `bearer ${secretValue}`, 'X-Request-ID': 'kept' } }),
        { status: 200 },
        'Valid credential',
      )
      const stored = await harness.outputs()
      equal(stored.length, 1, 'One admitted Run')
      const headers = stored[0]!.headers as Record<string, JsonValue>
      equal(headers.authorization, undefined, 'Credential header removed from outputs')
      equal(headers['x-request-id'], 'kept', 'Other headers kept')
    },
  },
  {
    fixture: {
      bindings: secretBinding,
      bodyFields: noInputs,
      method: 'POST',
      options: {
        allowedOrigins: ['https://client.example'],
        authentication: { name: 'X-Webhook-Secret', secret: { bindingId: 'secret', kind: 'binding' }, type: 'header' },
      },
      variables: { WEBHOOK_SECRET: secretValue },
    },
    name: 'checks a custom secret header after CORS preflight',
    async verify(harness) {
      const origin = 'https://client.example'
      await response(
        await call(harness, { headers: { 'Access-Control-Request-Method': 'POST', 'Origin': origin }, method: 'OPTIONS' }),
        { headers: { 'access-control-allow-origin': origin }, status: 204 },
        'Preflight without credential',
      )
      await response(
        await call(harness, { headers: { 'Origin': origin, 'X-Webhook-Secret': 'wrong' } }),
        { headers: { 'access-control-allow-origin': origin, 'www-authenticate': null }, status: 401 },
        'Wrong header secret',
      )
      await response(await call(harness, { headers: { Authorization: `Bearer ${secretValue}` } }), { status: 401 }, 'Bearer is not the configured header')
      equal(await harness.outputs(), [], 'Rejected requests admit no Run')
      await response(await call(harness, { headers: { 'x-webhook-secret': secretValue } }), { status: 200 }, 'Valid header secret')
      const stored = await harness.outputs()
      equal(stored.length, 1, 'One admitted Run')
      equal((stored[0]!.headers as Record<string, JsonValue>)['x-webhook-secret'], undefined, 'Secret header removed from outputs')
    },
  },
  {
    fixture: { bodyFields: messageInputs, method: 'POST', options: { bodyMode: 'any' } },
    name: 'accepts any JSON object or array body and ignores inactive declared fields',
    async verify(harness) {
      const accepted = [{ undeclared: { nested: [1, 2] } }, [{ id: 1 }, 'two'], []]
      for (const body of accepted) await response(await call(harness, { body: JSON.stringify(body) }), { status: 200 }, `Body ${JSON.stringify(body)}`)
      await response(await call(harness), { status: 200 }, 'Empty body')
      for (const body of ['"text"', '5', 'null', 'true', '{']) await response(await call(harness, { body }), { status: 400 }, `Rejected body ${body}`)
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [...accepted, {}],
        'Admitted bodies',
      )
    },
  },
  {
    fixture: { bodyFields: messageInputs, method: 'POST' },
    name: 'stores complete outputs and compares query and body for idempotency',
    async verify(harness) {
      const url = `${harness.endpointUrl}?tag=a&tag=b&single=x&__proto__=safe&constructor=value`
      const input = {
        url,
        body: JSON.stringify(messagePayload),
        headers: { 'Idempotency-Key': 'output-contract', 'X-Request-ID': 'first', 'Content-Type': 'application/json' },
      }
      const replies = await Promise.all([call(harness, input), call(harness, input)])
      equal(
        replies.map((reply) => reply.status),
        [200, 200],
        'Concurrent retry statuses',
      )
      const stored = await harness.outputs()
      equal(stored.length, 1, 'One admitted Run')
      const output = stored[0]!
      equal(Object.keys(output).toSorted(), ['body', 'headers', 'query', 'webhookUrl'], 'Exact output handles')
      equal(output.body, messagePayload, 'Body')
      equal(output.query, JSON.parse('{"tag":["a","b"],"single":"x","__proto__":"safe","constructor":"value"}'), 'Query')
      equal(output.webhookUrl, harness.endpointUrl, 'Endpoint without query')
      equal((output.headers as Record<string, JsonValue>)['x-request-id'], 'first', 'Lowercase headers')
      await response(await call(harness, { ...input, headers: { ...input.headers, 'X-Request-ID': 'retry' } }), { status: 200 }, 'Changed header retry')
      await response(await call(harness, { ...input, url: url.replace(new URL(url).host, 'retry.example.com') }), { status: 200 }, 'Changed request URL host')
      equal(await harness.outputs(), stored, 'First outputs remain unchanged')
      await response(await call(harness, { ...input, method: 'PUT' }), { headers: { allow: 'POST' }, status: 405 }, 'Rejected method')
      await response(await call(harness, { ...input, url: `${url}&extra=1` }), { status: 409 }, 'Changed query')
      await response(await call(harness, { ...input, body: JSON.stringify({ event: { message: 'changed' } }) }), { status: 409 }, 'Changed body')
    },
  },
  {
    fixture: { bodyFields: noInputs, method: 'POST' },
    name: 'rejects malformed and unknown endpoint identities',
    async verify(harness) {
      const endpoint = new URL(harness.endpointUrl)
      await response(
        await call(harness, { url: new URL('/v1/webhooks/not-an-endpoint', endpoint).href }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 404 },
        'Malformed endpoint',
      )
      await response(
        await call(harness, { url: new URL('/v1/webhooks/endpoint_00000000000000000000000000000000', endpoint).href }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 404 },
        'Unknown endpoint',
      )
    },
  },
  {
    fixture: { bodyFields: noInputs, method: 'POST' },
    name: 'uses configured POST and decodes an empty body as an empty object',
    async verify(harness) {
      await response(await call(harness, { method: 'GET' }), { headers: { 'allow': 'POST', 'cache-control': 'no-store' }, status: 405 }, 'Default method')
      await response(await call(harness), { body: '', headers: { 'cache-control': 'no-store' }, status: 200 }, 'Empty payload')
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [{}],
        'Decoded empty payloads',
      )
    },
  },
  {
    fixture: {
      bodyFields: noInputs,
      method: 'PUT',
      options: {
        allowedOrigins: ['https://client.example'],
        responseData: 'accepted',
        responseHeaders: { 'x-webhook-response': 'configured' },
        responseStatusCode: 202,
      },
    },
    name: 'applies configured methods, CORS, preflight, and success response',
    async verify(harness) {
      await response(
        await call(harness, {
          headers: {
            'access-control-request-headers': 'content-type, idempotency-key',
            'access-control-request-method': 'PUT',
            'origin': 'https://client.example',
          },
          method: 'OPTIONS',
        }),
        {
          body: '',
          headers: {
            'access-control-allow-headers': 'content-type, idempotency-key',
            'access-control-allow-methods': 'PUT',
            'access-control-allow-origin': 'https://client.example',
            'access-control-max-age': '600',
          },
          status: 204,
        },
        'Preflight',
      )
      await response(
        await call(harness, { body: '{}', headers: { origin: 'https://client.example' }, method: 'PUT' }),
        {
          body: 'accepted',
          headers: {
            'access-control-allow-origin': 'https://client.example',
            'cache-control': 'no-store',
            'x-webhook-response': 'configured',
          },
          status: 202,
        },
        'Configured success',
      )
      await response(
        await call(harness, { body: '{}', headers: { origin: 'https://other.example' }, method: 'PUT' }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 403 },
        'Disallowed origin',
      )
    },
  },
  {
    fixture: {
      bodyFields: noInputs,
      method: 'POST',
      options: {
        responseData: '<script>globalThis.compromised = true</script>',
        responseHeaders: {
          'access-control-allow-credentials': 'true',
          'content-security-policy': "default-src * 'unsafe-inline'",
          'content-type': 'text/html',
          'location': 'https://attacker.example',
          'set-cookie': 'open_flow_operator_session=forged',
          'x-accel-redirect': '/auth/session',
        },
      },
    },
    name: 'prevents Flow responses from becoming executable or controlling deployment headers',
    async verify(harness) {
      await response(
        await call(harness),
        {
          body: '<script>globalThis.compromised = true</script>',
          headers: {
            'access-control-allow-credentials': null,
            'content-security-policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
            'content-type': 'text/html',
            'location': null,
            'referrer-policy': 'no-referrer',
            'set-cookie': null,
            'x-accel-redirect': null,
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
          },
          status: 200,
        },
        'Safe configured response',
      )
    },
  },
  {
    fixture: { bodyFields: messageInputs, method: 'POST' },
    name: 'rejects invalid JSON, invalid payloads, invalid idempotency keys, and oversized bodies',
    async verify(harness) {
      await response(await call(harness, { body: '{' }), { body: '', headers: { 'cache-control': 'no-store' }, status: 400 }, 'Invalid JSON')
      await response(
        await call(harness, { body: JSON.stringify({ event: {} }) }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 400 },
        'Invalid payload',
      )
      await response(
        await call(harness, { body: JSON.stringify(messagePayload), headers: { 'idempotency-key': '   ' } }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 400 },
        'Empty key',
      )
      await response(
        await call(harness, { body: JSON.stringify(messagePayload), headers: { 'idempotency-key': 'x'.repeat(257) } }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 400 },
        'Oversized key',
      )
      await response(
        await call(harness, { body: 'x'.repeat(maximumWebhookBodyBytes + 1) }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 413 },
        'Oversized body',
      )
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [],
        'Rejected payloads',
      )
    },
  },
  {
    fixture: { bodyFields: messageInputs, method: 'POST' },
    name: 'replays one idempotent occurrence and rejects conflicting payloads',
    async verify(harness) {
      const headers = { 'idempotency-key': 'delivery-1' }
      await response(await call(harness, { body: JSON.stringify(messagePayload), headers }), { status: 200 }, 'Initial delivery')
      await response(await call(harness, { body: JSON.stringify(messagePayload), headers }), { status: 200 }, 'Repeated delivery')
      await response(
        await call(harness, { body: JSON.stringify({ event: { message: 'different' } }), headers }),
        { body: '', headers: { 'cache-control': 'no-store' }, status: 409 },
        'Conflicting delivery',
      )
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [messagePayload],
        'Idempotent payloads',
      )
    },
  },
  {
    fixture: { bodyFields: messageInputs, method: 'POST' },
    name: 'admits requests without an idempotency key as separate occurrences',
    async verify(harness) {
      const body = JSON.stringify(messagePayload)
      await response(await call(harness, { body }), { status: 200 }, 'First unkeyed delivery')
      await response(await call(harness, { body }), { status: 200 }, 'Second unkeyed delivery')
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [messagePayload, messagePayload],
        'Unkeyed payloads',
      )
    },
  },
  {
    fixture: { bodyFields: messageInputs, method: 'POST' },
    name: 'scopes occurrence identity to the current runtime version',
    async verify(harness) {
      const body = JSON.stringify(messagePayload)
      const headers = { 'idempotency-key': 'delivery-across-publish' }
      await response(await call(harness, { body, headers }), { status: 200 }, 'Delivery before publish')
      const endpointUrl = harness.endpointUrl
      await harness.republish()
      equal(harness.endpointUrl, endpointUrl, 'Endpoint after publish')
      await response(await call(harness, { body, headers }), { status: 200 }, 'Delivery after publish')
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [messagePayload, messagePayload],
        'Payloads across publish',
      )
    },
  },
  {
    fixture: { bodyFields: noInputs, method: 'POST' },
    name: 'fails closed after its trigger is retired',
    async verify(harness) {
      await harness.retire()
      await response(await call(harness, { body: '{}' }), { body: '', headers: { 'cache-control': 'no-store' }, status: 404 }, 'Retired endpoint')
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [],
        'Payloads after retirement',
      )
    },
  },
  {
    fixture: { bodyFields: noInputs, method: 'POST', options: { responseData: 'ignored', responseStatusCode: 204 } },
    name: 'omits a configured response body for null-body statuses',
    async verify(harness) {
      await response(await call(harness, { body: '{}' }), { body: '', status: 204 }, 'Null-body status')
    },
  },
  {
    fixture: { bodyFields: noInputs, method: 'GET', options: { responseData: 'ignored' } },
    name: 'omits the body output for GET requests',
    async verify(harness) {
      await response(await call(harness, { method: 'GET' }), { body: 'ignored', status: 200 }, 'GET response')
      const outputs = await harness.outputs()
      equal(outputs.length, 1, 'One GET run')
      equal(Object.keys(outputs[0]!).toSorted(), ['headers', 'query', 'webhookUrl'], 'GET outputs omit body')
      await response(await call(harness, { method: 'HEAD' }), { body: '', headers: { allow: 'GET' }, status: 405 }, 'HEAD rejected')
    },
  },
  {
    fixture: { bodyFields: formInputs, method: 'POST', options: { allowedOrigins: ['*'], form: {} } },
    name: 'admits hosted form submissions only from the endpoint origin and never stores browser credentials',
    async verify(harness) {
      const form = { 'content-type': 'application/x-www-form-urlencoded' }
      const credentials = { authorization: 'Basic c2VjcmV0', cookie: 'open_flow_operator_session=secret' }
      // allowedOrigins governs API callers; "*" must not admit an opaque or foreign origin for a form.
      for (const origin of ['null', 'https://other.example'])
        await response(await call(harness, { body: 'name=Ada', headers: { ...form, origin } }), { status: 403 }, `Form from ${origin}`)
      equal(await harness.outputs(), [], 'Rejected form submissions admit no Run')
      const own = new URL(harness.endpointUrl).origin
      await response(await call(harness, { body: 'name=Ada', headers: { ...form, ...credentials, origin: own } }), { status: 200 }, 'Same-origin form')
      await response(
        await call(harness, {
          body: JSON.stringify({ name: 'Json' }),
          headers: { ...credentials, 'content-type': 'application/json', 'origin': 'https://api.example' },
        }),
        { headers: { 'access-control-allow-origin': '*' }, status: 200 },
        'JSON caller allowed by "*"',
      )
      for (const outputs of await harness.outputs()) {
        const headers = outputs.headers as Record<string, JsonValue>
        equal([headers.cookie, headers.authorization], [undefined, undefined], 'Browser credentials removed from outputs')
      }
    },
  },
  {
    fixture: {
      bodyFields: formInputs,
      method: 'POST',
      options: { form: { description: 'Tell us <who> you are', title: 'Sign <up>' }, responseData: 'accepted', responseStatusCode: 201 },
    },
    name: 'serves an escaped hosted form and converts form submissions to typed body outputs',
    async verify(harness) {
      const page = await call(harness, { headers: { 'Accept-Language': 'en' }, method: 'GET' })
      await response(
        page,
        { headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' }, status: 200 },
        'Form page',
      )
      const html = await page.text()
      for (const text of ['Sign &#60;up&#62;', 'Tell us &#60;who&#62; you are', 'name="name"', 'name="count"', 'name="subscribe"', 'name="plan"'])
        if (!html.includes(text)) throw new Error(`Form page is missing ${text}.`)
      if (html.includes('<up>')) throw new Error('Form page did not escape its title.')
      equal(page.headers.get('content-security-policy')?.includes("form-action 'self'"), true, 'Form page CSP')
      // Browsers send `Origin: null` for a POST from a no-referrer page, so the page must keep its origin.
      equal(page.headers.get('referrer-policy'), 'same-origin', 'Form page referrer policy')
      const form = { 'content-type': 'application/x-www-form-urlencoded' }
      const origin = new URL(harness.endpointUrl).origin
      const accepted = await call(harness, { body: 'name=Ada&count=3&subscribe=on&plan=pro&ignored=x', headers: { ...form, origin } })
      equal(accepted.status, 200, 'Same-origin submission status ignores the API response status')
      equal(accepted.headers.get('content-type'), 'text/html; charset=utf-8', 'Submission result is a page')
      await response(await call(harness, { body: 'name=Grace', headers: form }), { status: 200 }, 'Absent checkbox')
      await response(await call(harness, { body: 'name=Ada&count=many', headers: form }), { status: 400 }, 'Invalid integer')
      await response(await call(harness, { body: 'count=1', headers: form }), { status: 400 }, 'Missing required field')
      await response(await call(harness, { body: 'name=Ada&name=Grace', headers: form }), { status: 400 }, 'Repeated field')
      const multipart = new FormData()
      multipart.set('name', new Blob(['file']), 'name.txt')
      await response(await harness.request(new Request(harness.endpointUrl, { body: multipart, method: 'POST' })), { status: 400 }, 'File part')
      await response(
        await call(harness, { body: 'name=Ada', headers: { ...form, origin: 'https://other.example' } }),
        { status: 403 },
        'Cross-origin submission',
      )
      await response(await call(harness, { body: 'name=Ada', headers: { ...form, origin: 'null' } }), { status: 403 }, 'Opaque-origin submission')
      await response(
        await call(harness, { body: JSON.stringify({ name: 'Json' }), headers: { 'content-type': 'application/json' } }),
        { body: 'accepted', status: 201 },
        'JSON request',
      )
      equal(
        (await harness.outputs()).map((outputs) => outputs.body),
        [{ count: 3, name: 'Ada', plan: 'pro', subscribe: true }, { name: 'Grace', subscribe: false }, { name: 'Json' }],
        'Admitted form bodies',
      )
    },
  },
]
