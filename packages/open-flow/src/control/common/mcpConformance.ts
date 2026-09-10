import type { ControlApiConformanceCase, ControlApiConformanceHarness } from './conformance.ts'

import { dequal } from 'dequal/lite'
import { ControlClient } from './api.ts'
import { mcpProtocolVersion, mcpTools } from './mcp.ts'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function rpc(harness: ControlApiConformanceHarness, method: string, params?: Record<string, unknown>) {
  const response = await harness.request(
    new Request(new URL('/v1/mcp', harness.origin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'mcp-protocol-version': mcpProtocolVersion,
        'mcp-method': method,
        ...(method == 'tools/call' ? { 'mcp-name': String(params?.name) } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method,
        params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': mcpProtocolVersion, 'io.modelcontextprotocol/clientCapabilities': {} } },
      }),
    }),
  )
  assert(response.ok, `MCP ${method} returned HTTP ${response.status}: ${response.ok ? '' : await response.text()}.`)
  assert(response.headers.get('mcp-session-id') == null, 'MCP must not create a session.')
  const source = await response.text()
  const body = response.headers.get('content-type')?.includes('text/event-stream')
    ? JSON.parse(
        source
          .split('\n')
          .findLast((line) => line.startsWith('data:'))
          ?.slice(5) ?? 'null',
      )
    : JSON.parse(source)
  assert(body != null && body.error == null, `MCP ${method} failed: ${JSON.stringify(body)}.`)
  return body.result as Record<string, unknown>
}

export const mcpConformanceCases: readonly ControlApiConformanceCase[] = [
  {
    name: 'publishes the public MCP catalog, input schemas and annotations',
    async verify(harness) {
      const result = await rpc(harness, 'tools/list')
      assert(Array.isArray(result.tools), 'MCP tools must be an array.')
      assert(result.tools.length == Object.keys(mcpTools).length, 'MCP tool count differs from the public contract.')
      for (const [name, definition] of Object.entries(mcpTools)) {
        const actual = result.tools.find((candidate) => candidate.name == name)
        assert(actual != null, `Missing MCP tool ${name}.`)
        assert(actual.description == definition.description, `${name} description differs.`)
        assert(dequal(actual.annotations, definition.annotations), `${name} annotations differ.`)
        const expected = definition.inputSchema['~standard'].jsonSchema.input()
        const { $schema: _, ...schema } = expected
        const { $schema: __, ...received } = actual.inputSchema
        assert(dequal(received, schema), `${name} input schema differs.`)
      }
    },
  },
  {
    name: 'shares Run pagination, status filters and cancellation between MCP and REST',
    async verify(harness) {
      const client = new ControlClient((url, init) => harness.request(new Request(new URL(url, harness.origin), init)))
      const flow = await client.createFlow('MCP Run listing')
      const changed = await client.changeDraft(flow.flowId, flow.draftRevisionId, [
        { kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
      ])
      const args = {
        source: 'draft',
        flowId: flow.flowId,
        revisionId: changed.revision.revisionId,
        trigger: { nodeId: 'start', payload: {} },
      }
      const runs: string[] = []
      for (let index = 0; index < 2; index++) {
        const accepted = await rpc(harness, 'tools/call', { name: 'flow_run', arguments: { ...args, idempotencyKey: crypto.randomUUID() } })
        const run = accepted.structuredContent as Record<string, unknown>
        assert(typeof run.runId == 'string', 'MCP must return an accepted Run ID.')
        runs.push(run.runId)
      }
      const first = await rpc(harness, 'tools/call', { name: 'run_list', arguments: { flowId: flow.flowId, limit: 1 } })
      const page = first.structuredContent as { runs: { runId: string }[]; nextCursor: string }
      assert(page.runs.length == 1 && typeof page.nextCursor == 'string', 'Run listing must paginate.')
      const rest = await client.listRuns(flow.flowId, { cursor: page.nextCursor, limit: 1 })
      assert(rest.runs.length == 1 && rest.runs[0]?.runId != page.runs[0]?.runId, 'REST must continue the MCP Run cursor without duplicates.')
      const restFirst = await client.listRuns(flow.flowId, { limit: 1 })
      const next = await rpc(harness, 'tools/call', { name: 'run_list', arguments: { flowId: flow.flowId, cursor: restFirst.nextCursor, limit: 1 } })
      assert(dequal(next.structuredContent, rest), 'MCP must continue the REST Run cursor.')
      await rpc(harness, 'tools/call', { name: 'run_cancel', arguments: { runId: runs[0] } })
      const filtered = await rpc(harness, 'tools/call', { name: 'run_list', arguments: { flowId: flow.flowId, status: 'canceled' } })
      assert(dequal(filtered.structuredContent, await client.listRuns(flow.flowId, { status: 'canceled' })), 'MCP and REST status filters differ.')
      const other = await client.createFlow('Other Run scope')
      const invalid = await rpc(harness, 'tools/call', { name: 'run_list', arguments: { flowId: other.flowId, cursor: page.nextCursor } })
      assert(invalid.isError == true, 'Run cursors must reject a different Flow scope.')
      assert((invalid.structuredContent as { error: { code: string } }).error.code == 'page.invalid-cursor', 'Run cursor error must match REST.')
    },
  },
  {
    name: 'shares mutation receipts and authoritative Drafts between MCP and REST',
    async verify(harness) {
      const args = { name: 'MCP conformance', idempotencyKey: crypto.randomUUID() }
      const call = () => rpc(harness, 'tools/call', { name: 'flow_create', arguments: args })
      const created = await call()
      assert(created.isError != true, 'MCP Flow creation failed.')
      const flow = created.structuredContent as Record<string, unknown>
      assert(typeof flow.flowId == 'string', 'MCP did not return a Flow ID.')
      const retry = await call()
      assert(dequal(retry.structuredContent, flow), 'MCP mutation replay changed identity.')
      const response = await harness.request(new Request(new URL(`/v1/flows/${encodeURIComponent(flow.flowId)}/draft`, harness.origin)))
      assert(response.ok, 'REST cannot read the Flow created through MCP.')
      const draft = (await response.json()) as Record<string, unknown>
      assert(draft.revisionId == flow.draftRevisionId, 'MCP and REST disagree on the Draft head.')
      const conflict = await rpc(harness, 'tools/call', { name: 'flow_create', arguments: { ...args, name: 'Changed retry' } })
      assert(conflict.isError == true, 'MCP must reject a changed idempotent replay.')
      assert((conflict.structuredContent as { error: { code: string } }).error.code == 'flow.conflict', 'MCP must preserve the Control error code.')
    },
  },
]
