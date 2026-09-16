import type { JsonValue, WebhookBodyField, WebhookOptions } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'

export const maximumWebhookBodyBytes = 64 * 1024

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
  readonly bodyFields: readonly WebhookBodyField[]
  readonly options?: WebhookOptions
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

export const webhookConformanceCases: readonly WebhookConformanceCase[] = [
  {
    fixture: { bodyFields: messageInputs, options: { allowedMethods: ['POST', 'PUT'] } },
    name: 'stores complete outputs and compares method query and body for idempotency',
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
      await response(await call(harness, { ...input, method: 'PUT' }), { status: 409 }, 'Changed method')
      await response(await call(harness, { ...input, url: `${url}&extra=1` }), { status: 409 }, 'Changed query')
      await response(await call(harness, { ...input, body: JSON.stringify({ event: { message: 'changed' } }) }), { status: 409 }, 'Changed body')
    },
  },
  {
    fixture: { bodyFields: noInputs },
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
    fixture: { bodyFields: noInputs },
    name: 'uses POST by default and decodes an empty body as an empty object',
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
      options: {
        allowedMethods: ['PUT'],
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
            'content-type': 'text/plain;charset=UTF-8',
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
    fixture: { bodyFields: messageInputs },
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
    fixture: { bodyFields: messageInputs },
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
    fixture: { bodyFields: messageInputs },
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
    fixture: { bodyFields: messageInputs },
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
    fixture: { bodyFields: noInputs },
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
    fixture: { bodyFields: noInputs, options: { responseData: 'ignored', responseStatusCode: 204 } },
    name: 'omits a configured response body for null-body statuses',
    async verify(harness) {
      await response(await call(harness, { body: '{}' }), { body: '', status: 204 }, 'Null-body status')
    },
  },
  {
    fixture: { bodyFields: noInputs, options: { allowedMethods: ['HEAD'], responseData: 'ignored' } },
    name: 'omits the response body for HEAD requests',
    async verify(harness) {
      await response(await call(harness, { method: 'HEAD' }), { body: '', status: 200 }, 'HEAD response')
    },
  },
]
