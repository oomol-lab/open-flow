import type { RevisionContent, WebhookOptions } from '@oomol-lab/open-flow/flow-change'

import { connectorProxyConfigSchema, connectorProxyTask } from '@oomol-lab/open-flow/connector-proxy'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { validateFlow } from '@oomol-lab/open-flow/flow-semantics'
import { httpRequestConfigSchema, httpRequestTask } from '@oomol-lab/open-flow/http-request'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { createServer } from 'node:http'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { acceptRun, storeRevision } from './runFixture.ts'
import { closeOpenServices, openService, startService } from './serviceFixture.ts'

const artifactPort = { jsonSchema: { contentMediaType: 'oomol/artifact' }, nullable: false } as const
let origin = ''
const uploads: { readonly contentType?: string; readonly bytes: number[] }[] = []

beforeAll(async () => {
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    uploads.push({ contentType: request.headers['content-type'], bytes: [...body] })
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="echo.bin"' })
    response.end(Buffer.concat([body, Buffer.from([7])]))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address == null || typeof address == 'string') throw new Error('No server address')
  origin = `http://127.0.0.1:${address.port}`
  return () => {
    server.closeAllConnections()
    server.close()
  }
})

afterEach(async () => {
  uploads.length = 0
  await closeOpenServices()
})

/** Code puts a PDF Artifact, HTTP uploads it as a binary body and stores the echoed response, the Webhook returns it. */
function revision(mode: 'node' | 'outputs'): RevisionContent {
  const upload = httpRequestTask(httpRequestConfigSchema.parse({ method: 'PUT', bodyFormat: 'binary', responseFormat: 'artifact' }), 'Upload')
  const options: WebhookOptions =
    mode == 'node'
      ? { responseBody: { kind: 'webhook-response', nodeId: 'reply' } }
      : { responseBody: { kind: 'workflow-outputs', bodyFormat: 'artifact', output: 'file' }, responseStatusCode: 201 }
  return {
    document: {
      bindings: {},
      graph: {
        edges: [
          { source: 'hook', target: 'produce' },
          { source: 'produce', target: 'upload' },
          { source: 'upload', target: mode == 'node' ? 'reply' : 'outputs' },
        ],
        nodes: {
          hook: { bodyFields: [], kind: 'webhook', method: 'POST', name: 'Hook', options },
          produce: {
            inputs: {},
            kind: 'task',
            task: { inputs: [], moduleId: 'produce', name: 'Produce', outputs: [{ ...artifactPort, handle: 'file' }] },
          },
          upload: {
            inputs: {
              url: { kind: 'value', value: `${origin}/upload` },
              body: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'produce', output: 'file' }] },
            },
            kind: 'task',
            task: upload,
          },
          ...(mode == 'node'
            ? {
                reply: {
                  bodyFormat: 'artifact' as const,
                  inputs: {
                    body: { kind: 'sources' as const, sources: [{ kind: 'node' as const, nodeId: 'upload', output: 'body' }] },
                    statusCode: { kind: 'value' as const, value: 202 },
                    headers: { kind: 'value' as const, value: { 'Content-Type': 'text/html', 'X-Kept': 'yes' } },
                  },
                  kind: 'webhook-response' as const,
                  name: 'Reply',
                },
              }
            : {
                outputs: {
                  kind: 'outputs' as const,
                  name: 'Outputs',
                  outputDefs: [{ ...artifactPort, handle: 'file' }],
                  outputMappings: { file: { kind: 'sources' as const, sources: [{ kind: 'node' as const, nodeId: 'upload', output: 'body' }] } },
                },
              }),
        },
      },
    },
    modelVersion: currentFlowModelVersion,
    modules: {
      produce: {
        imports: [],
        name: 'Produce',
        source: `export default async (_inputs, context) => ({
  file: await context.artifact.put(new Uint8Array([37, 80, 68, 70]), { name: '发票 "1".pdf', mediaType: 'application/pdf' }),
})`,
      },
    },
  }
}

async function call(mode: 'node' | 'outputs') {
  const checked = await validateFlow(revision(mode), findEngineContract(currentEngineContract)!)
  if (checked.diagnostics.length > 0) throw new Error(JSON.stringify(checked.diagnostics.map((item) => [item.code, item.path, item.message])))
  const service = await openService(':memory:')
  const stored = await storeRevision(service, revision(mode), `artifact-${mode}`)
  await service.control.publications.publishFlow('test', stored.flowId, stored.revisionId, currentEngineContract, null, 'publish')
  await service.tickMaintenance()
  await startService(service)
  const url = service.control.publications.getFlowTriggerBinding('test', stored.flowId, 'hook', 'http://server.local').endpointUrl!
  const response = await createServerApp(service).request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  await service.waitForIdle()
  return { response, service, flowId: stored.flowId }
}

it('uploads a Code Artifact, stores the HTTP response as an Artifact and sends it from a Webhook Response node', async () => {
  const { response, service, flowId } = await call('node')
  expect(response.status).toBe(202)
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([37, 80, 68, 70, 7])
  expect(response.headers.get('content-type')).toBe('application/octet-stream')
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="echo.bin"; filename*=UTF-8''echo.bin`)
  expect(response.headers.get('x-kept')).toBe('yes')
  expect(response.headers.get('content-security-policy')).toContain('sandbox')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(uploads).toEqual([{ contentType: 'application/pdf', bytes: [37, 80, 68, 70] }])
  const runId = service.control.runs.listRuns('test', flowId, 1).page.runs[0]?.runId
  if (runId == null) throw new Error('Missing Run')
  const artifacts = service.events(runId).filter((event) => event.kind == 'node.artifact')
  expect(artifacts.map((event) => (event.payload as { nodeId: string }).nodeId)).toEqual(['produce', 'upload'])
})

it('sends an Artifact workflow output with its stored name and the fixed status', async () => {
  const { response } = await call('outputs')
  expect(response.status).toBe(201)
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([37, 80, 68, 70, 7])
  expect(response.headers.get('content-disposition')).toContain('echo.bin')
})

it('stores a Provider API response as an Artifact with exact bytes and a null encoding', async () => {
  const connector = createConnectorHost({
    checkProxy: async () => {},
    proxy: async () => ({
      data: Buffer.from([0, 255, 16]).toString('base64'),
      status: 200,
      bodyEncoding: 'base64',
      headers: { 'content-type': 'image/png' },
    }),
  })
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  await startService(service)
  const accepted = await acceptRun(service, {
    flowId: 'proxy',
    idempotencyKey: 'proxy-artifact',
    revisionId: 'proxy-artifact',
    revision: {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            download: {
              kind: 'task',
              name: 'Download',
              task: connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'drive', responseFormat: 'artifact' })),
              inputs: { endpoint: { kind: 'value', value: '/files/abc/photo.png' } },
            },
          },
        },
      },
    },
  })
  if (accepted.kind != 'accepted') throw new Error('Expected accepted Run.')
  await service.waitForIdle()
  const result = service.control.runs.getRunResult('test', accepted.runId) as unknown as {
    readonly result: { readonly nodes: readonly { readonly nodeId: string; readonly outputs: Readonly<Record<string, unknown>> }[] }
    readonly status: string
  }
  expect(result.status).toBe('completed')
  const outputs = result.result.nodes.find((node) => node.nodeId == 'download')?.outputs ?? {}
  const events = service.events(accepted.runId)
  expect(outputs).toMatchObject({ body: { kind: 'artifact', name: 'photo.png', mediaType: 'image/png', size: 3 }, statusCode: 200, bodyEncoding: null })
  const artifact = events.find((event) => event.kind == 'node.artifact')
  expect(artifact?.payload).toMatchObject({ nodeId: 'download' })
  const id = (outputs.body as { id: string }).id
  expect([...(service.runArtifact(accepted.runId, id)?.content ?? [])]).toEqual([0, 255, 16])
})
