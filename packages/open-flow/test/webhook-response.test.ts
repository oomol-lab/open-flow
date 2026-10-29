import type { AuthoringHost } from '../src/control/common/authoring.ts'
import type { JsonValue, RevisionContent, WebhookOptions } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { authoringNode, compileAuthoring } from '../src/control/common/authoring.ts'
import { applyFlowChanges, currentFlowModelVersion, upgradeRevisionContent } from '../src/flow/common/change.ts'
import { decodeRevision, decodeRevisionContent, encodeRevision } from '../src/flow/common/encoding.ts'
import { validateFlowGraph, webhookResponseDiagnostics } from '../src/flow/common/graph.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { updateOutputsDefs } from '../src/flow/common/nodeChanges.ts'
import { webhookResponseBody, webhookResponseHeaders, webhookResponseStatusCode } from '../src/trigger/common/webhook.ts'

const field = { handle: 'message', jsonSchema: { type: 'string' }, nullable: false } as const
function content(options: WebhookOptions = { responseBody: { kind: 'workflow-outputs' } }): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        nodes: {
          hook: { kind: 'webhook', name: 'Webhook', method: 'POST', bodyFields: [], options },
          outputs: { kind: 'outputs', name: 'Outputs', outputDefs: [field], outputMappings: { message: { kind: 'value', value: 'hello' } } },
        },
        edges: [{ source: 'hook', target: 'outputs' }],
      },
    },
  }
}
const host: AuthoringHost = {
  id: (label) => label,
  action: async () => {
    throw new Error('Unused')
  },
  trigger: () => {
    throw new Error('Unused')
  },
  openapi: async () => {
    throw new Error('Unused')
  },
}

describe('workflow HTTP response contract', () => {
  it.each([200, 201, 400, 599])('projects a valid status %s from business outputs', (status) => {
    expect(webhookResponseStatusCode({ kind: 'node-results', outputs: { status } }, 'status')).toBe(status)
  })

  it.each<JsonValue>([null, '201', false, {}, [], 199, 600, 204, 205, 304, 200.5])('rejects invalid status %j without coercion or fallback', (status) => {
    expect(webhookResponseStatusCode({ kind: 'node-results', outputs: { status }, nodes: [{ outputs: { status: 201 } }] }, 'status')).toBeUndefined()
  })

  it('requires executed business outputs for a selected status', () => {
    expect(webhookResponseStatusCode({ kind: 'node-results', nodes: [{ outputs: { status: 201 } }] }, 'status')).toBeUndefined()
    expect(webhookResponseStatusCode({ kind: 'node-results', outputs: {} }, 'toString')).toBeUndefined()
  })

  it('checks status mode, field existence and numeric type and preserves stale references through removal', () => {
    const original = content({ responseBody: { kind: 'workflow-outputs' }, responseStatusCode: 202, responseStatusCodeOutput: 'message' })
    expect(validateFlowGraph(original)).toContainEqual(expect.objectContaining({ code: 'trigger.webhook-response-status-output-type' }))
    const numeric = applyFlowChanges(
      original,
      updateOutputsDefs(original, 'outputs', [{ ...field, jsonSchema: { type: 'integer' } }], { message: { kind: 'value', value: 201 } }),
    )
    expect(validateFlowGraph(numeric)).toEqual([])
    const renamed = applyFlowChanges(numeric, updateOutputsDefs(numeric, 'outputs', [{ ...field, handle: 'status', jsonSchema: { type: 'integer' } }]))
    expect(authoringNode(renamed, 'hook').config).toMatchObject({ options: { responseStatusCode: 202, responseStatusCodeOutput: 'status' } })
    expect(
      applyFlowChanges(
        renamed,
        inverseFlowChanges(numeric, updateOutputsDefs(numeric, 'outputs', [{ ...field, handle: 'status', jsonSchema: { type: 'integer' } }])),
      ),
    ).toEqual(numeric)
    const removed = applyFlowChanges(renamed, updateOutputsDefs(renamed, 'outputs', []))
    expect(authoringNode(removed, 'hook').config).toMatchObject({ options: { responseStatusCodeOutput: 'status' } })
    expect(validateFlowGraph(removed)).toContainEqual(expect.objectContaining({ code: 'trigger.webhook-response-status-output-missing' }))
    expect(validateFlowGraph(content({ responseStatusCodeOutput: 'message' }))).toContainEqual(
      expect.objectContaining({ code: 'trigger.webhook-response-status-source' }),
    )
    expect(() => decodeRevisionContent({ ...content({ responseStatusCodeOutput: 'message' }), modelVersion: 9 })).toThrow('version 10')
    expect(decodeRevision(encodeRevision(numeric))).toEqual(numeric)
  })

  it('creates and clears a status output through public authoring while retaining the fixed status', async () => {
    const original = content({ responseBody: { kind: 'workflow-outputs' }, responseStatusCode: 202 })
    const created = await compileAuthoring(
      original,
      {
        baseRevision: 'base',
        requestId: 'status',
        edits: [{ op: 'node.update', node: 'hook', set: { config: { options: { responseStatusCodeOutput: 'message' } } } }],
      },
      host,
    )
    const updated = applyFlowChanges(original, created.operations)
    expect(authoringNode(updated, 'hook').config).toMatchObject({ options: { responseStatusCode: 202, responseStatusCodeOutput: 'message' } })
    const cleared = await compileAuthoring(
      updated,
      {
        baseRevision: 'base',
        requestId: 'clear-status',
        edits: [{ op: 'node.update', node: 'hook', clear: [['config', 'options', 'responseStatusCodeOutput']] }],
      },
      host,
    )
    expect(applyFlowChanges(updated, cleared.operations)).toEqual(original)
  })
  it.each<JsonValue>(['hello', '', '<script>alert(1)</script>', { answer: 42 }, [1, null], 0, false, null])('encodes a selected value %j', (value) => {
    expect(webhookResponseBody({ kind: 'node-results', outputs: { message: value }, nodes: [] }, { kind: 'workflow-outputs', output: 'message' })).toEqual({
      body: typeof value == 'string' ? value : JSON.stringify(value),
      contentType: typeof value == 'string' ? 'text/plain;charset=UTF-8' : 'application/json',
    })
  })

  it('returns only business outputs and distinguishes an empty executed output from absent outputs', () => {
    const source = { kind: 'workflow-outputs' } as const
    expect(webhookResponseBody({ kind: 'node-results', outputs: { message: 'hello' }, nodes: [{ outputs: { secret: 'internal' } }] }, source)).toEqual({
      body: '{"message":"hello"}',
      contentType: 'application/json',
    })
    expect(webhookResponseBody({ kind: 'node-results', outputs: {}, nodes: [] }, source)?.body).toBe('{}')
    expect(webhookResponseBody({ kind: 'node-results', nodes: [] }, source)).toBeUndefined()
    expect(webhookResponseBody({ kind: 'node-results', outputs: {} }, { ...source, output: 'toString' })).toBeUndefined()
  })

  it('round trips configuration and preserves historical v9 bytes on read', () => {
    const original = content({ responseBody: { kind: 'workflow-outputs', output: 'message', timeoutMs: 1000 }, responseData: 'fixed' })
    expect(decodeRevision(encodeRevision(original))).toEqual(original)
    expect(() => decodeRevisionContent({ ...original, modelVersion: 9 })).toThrow('version 10')
    const historical = { ...content({ responseData: 'fixed' }), modelVersion: 9 as const }
    const bytes = encodeRevision(historical)
    expect(encodeRevision(decodeRevision(bytes))).toEqual(bytes)
    expect(upgradeRevisionContent(historical)).toEqual({ ...historical, modelVersion: currentFlowModelVersion })
    expect(() => decodeRevisionContent({ ...original, modelVersion: currentFlowModelVersion + 1 })).toThrow()
  })

  it.each([0, 999, 60_001, 1000.5])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => decodeRevisionContent(content({ responseBody: { kind: 'workflow-outputs', timeoutMs } }))).toThrow()
  })

  it('checks missing, disconnected, and removed output configuration and bodyless statuses', () => {
    const original = content()
    const graph = original.document.graph
    expect(validateFlowGraph(original)).toEqual([])
    expect(validateFlowGraph({ ...original, document: { ...original.document, graph: { ...graph, edges: [] } } })).toContainEqual(
      expect.objectContaining({ code: 'trigger.webhook-response-unreachable' }),
    )
    expect(validateFlowGraph({ ...original, document: { bindings: {}, graph: { nodes: { hook: graph.nodes.hook! }, edges: [] } } })).toContainEqual(
      expect.objectContaining({ code: 'trigger.webhook-response-outputs-missing' }),
    )
    expect(validateFlowGraph(content({ responseBody: { kind: 'workflow-outputs', output: 'missing' } }))).toContainEqual(
      expect.objectContaining({ code: 'trigger.webhook-response-output-missing' }),
    )
    for (const responseStatusCode of [204, 205, 304]) {
      expect(validateFlowGraph(content({ responseBody: { kind: 'workflow-outputs' }, responseStatusCode }))).toContainEqual(
        expect.objectContaining({ code: 'trigger.webhook-response-status-invalid' }),
      )
      expect(validateFlowGraph(content({ responseStatusCode }))).toEqual([])
    }
  })

  it.each([false, true])('skips ambiguous output checks with duplicate Outputs nodes (reversed: %s)', (reversed) => {
    const original = content({
      responseBody: { kind: 'workflow-outputs', output: 'missing' },
      responseStatusCodeOutput: 'message',
    })
    const { hook, outputs } = original.document.graph.nodes
    const duplicate = { kind: 'outputs', name: 'Duplicate Outputs', outputDefs: [], outputMappings: {} } as const
    const graph = {
      nodes: reversed ? { hook: hook!, duplicate, outputs: outputs! } : { hook: hook!, outputs: outputs!, duplicate },
      edges: [{ source: 'hook', target: 'duplicate' }],
    }
    expect(webhookResponseDiagnostics(graph, 'hook')).toEqual([])
    expect(validateFlowGraph({ ...original, document: { ...original.document, graph } }).map(({ code }) => code)).toEqual([
      'graph.outputs-duplicate',
      'graph.outputs-duplicate',
    ])

    const bodyless = content({ responseBody: { kind: 'workflow-outputs' }, responseStatusCode: 204 })
    expect(webhookResponseDiagnostics({ ...graph, nodes: { ...graph.nodes, hook: bodyless.document.graph.nodes.hook! } }, 'hook')).toEqual([
      expect.objectContaining({ code: 'trigger.webhook-response-status-invalid' }),
    ])
  })

  it.each<JsonValue>(['text', '', 0, 3.5, true, false])('projects a scalar header %j without changing fixed text', (value) => {
    expect(
      webhookResponseHeaders(
        { kind: 'node-results', outputs: { value } },
        { responseHeaders: { 'x-value': 'saved', 'X-Fixed': 'kept' }, responseHeaderOutputs: { 'X-Value': 'value' } },
      ),
    ).toEqual({ 'X-Value': String(value), 'X-Fixed': 'kept' })
    expect(
      webhookResponseHeaders(
        { kind: 'node-results', outputs: { headers: { 'X-Value': value } } },
        {
          responseHeadersSource: { kind: 'workflow-outputs', output: 'headers' },
          responseHeaders: { 'X-Ignored': 'saved' },
          responseHeaderOutputs: { 'X-Ignored': 'missing' },
        },
      ),
    ).toEqual({ 'X-Value': String(value) })
  })

  it.each<JsonValue>([null, [], {}, 'bad\r\nX-Injected: value', 'bad\u0000value', '😀'])('rejects invalid or unencodable header values %j', (value) => {
    expect(
      webhookResponseHeaders(
        { kind: 'node-results', outputs: { value } },
        { responseHeaders: { 'X-Value': 'saved' }, responseHeaderOutputs: { 'X-Value': 'value' } },
      ),
    ).toBeUndefined()
    expect(
      webhookResponseHeaders({ kind: 'node-results', outputs: { 'X-Value': value } }, { responseHeadersSource: { kind: 'workflow-outputs' } }),
    ).toBeUndefined()
  })

  it('rejects missing outputs, invalid names and case-insensitive duplicates, and permits empty headers', () => {
    for (const result of [
      { kind: 'node-results' },
      { kind: 'node-results', outputs: {} },
      { kind: 'node-results', nodes: [{ outputs: { value: 'private' } }] },
    ])
      expect(webhookResponseHeaders(result, { responseHeaderOutputs: { 'X-Value': 'value' } })).toBeUndefined()
    for (const headers of [{ 'bad name': 'value' }, { 'X-Count': 1, 'x-count': 2 }])
      expect(webhookResponseHeaders({ kind: 'node-results', outputs: headers }, { responseHeadersSource: { kind: 'workflow-outputs' } })).toBeUndefined()
    expect(webhookResponseHeaders({ kind: 'node-results', outputs: {} }, { responseHeadersSource: { kind: 'workflow-outputs' } })).toEqual({})
    expect(webhookResponseHeaders({}, { responseHeaders: { 'X-Fixed': 'saved' } })).toEqual({ 'X-Fixed': 'saved' })
  })

  it('checks header references and ignores inactive per-header configuration under a whole-object source', () => {
    expect(validateFlowGraph(content({ responseBody: { kind: 'workflow-outputs' }, responseHeaderOutputs: { 'X-Message': 'message' } }))).toEqual([])
    expect(
      validateFlowGraph(content({ responseBody: { kind: 'workflow-outputs' }, responseHeadersSource: { kind: 'workflow-outputs', output: 'message' } })),
    ).toContainEqual(expect.objectContaining({ code: 'trigger.webhook-response-header-output-type' }))
    expect(
      validateFlowGraph(
        content({
          responseBody: { kind: 'workflow-outputs' },
          responseHeadersSource: { kind: 'workflow-outputs' },
          responseHeaderOutputs: { 'bad name': 'missing' },
        }),
      ),
    ).toEqual([])
    for (const responseHeaderOutputs of [{ 'X-Missing': 'removed' }, { 'bad name': 'message' }] as readonly Readonly<Record<string, string>>[])
      expect(validateFlowGraph(content({ responseBody: { kind: 'workflow-outputs' }, responseHeaderOutputs }))).not.toEqual([])
    expect(validateFlowGraph(content({ responseHeaderOutputs: { 'X-Message': 'message' } }))).toContainEqual(
      expect.objectContaining({ code: 'trigger.webhook-response-headers-source' }),
    )
  })

  it('renames whole-object and inactive per-header references together and retains removed references', () => {
    const original = content({
      responseBody: { kind: 'workflow-outputs' },
      responseHeaders: { 'X-Message': 'saved' },
      responseHeadersSource: { kind: 'workflow-outputs', output: 'message' },
      responseHeaderOutputs: { 'X-Message': 'message' },
    })
    const changes = updateOutputsDefs(original, 'outputs', [{ ...field, handle: 'renamed' }])
    const renamed = applyFlowChanges(original, changes)
    expect(authoringNode(renamed, 'hook').config).toMatchObject({
      options: { responseHeadersSource: { output: 'renamed' }, responseHeaderOutputs: { 'X-Message': 'renamed' } },
    })
    expect(applyFlowChanges(renamed, inverseFlowChanges(original, changes))).toEqual(original)
    const removed = applyFlowChanges(original, updateOutputsDefs(original, 'outputs', []))
    expect(authoringNode(removed, 'hook').config).toMatchObject({
      options: { responseHeadersSource: { output: 'message' }, responseHeaderOutputs: { 'X-Message': 'message' } },
    })
    expect(validateFlowGraph(removed)).toContainEqual(expect.objectContaining({ code: 'trigger.webhook-response-header-output-missing' }))
  })

  it('creates, reads and clears header sources through public authoring and enforces the model boundary', async () => {
    const original = content({ responseData: 'saved', responseHeaders: { 'X-Fixed': 'kept' } })
    const created = await compileAuthoring(
      original,
      {
        baseRevision: 'base',
        requestId: 'headers',
        edits: [
          {
            op: 'node.update',
            node: 'hook',
            set: {
              config: {
                options: {
                  responseBody: { kind: 'workflow-outputs' },
                  responseHeadersSource: { kind: 'workflow-outputs' },
                  responseHeaderOutputs: { 'X-Message': 'message' },
                },
              },
            },
          },
        ],
      },
      host,
    )
    const updated = applyFlowChanges(original, created.operations)
    expect(authoringNode(updated, 'hook').config).toMatchObject({
      options: {
        responseHeaders: { 'X-Fixed': 'kept' },
        responseHeadersSource: { kind: 'workflow-outputs' },
        responseHeaderOutputs: { 'X-Message': 'message' },
      },
    })
    expect(decodeRevision(encodeRevision(updated))).toEqual(updated)
    for (const options of [{ responseHeadersSource: { kind: 'workflow-outputs' } }, { responseHeaderOutputs: { 'X-Message': 'message' } }] as const)
      expect(() => decodeRevisionContent({ ...content(options), modelVersion: 9 })).toThrow('version 10')
    const merged = applyFlowChanges(
      updated,
      (
        await compileAuthoring(
          updated,
          {
            baseRevision: 'base',
            requestId: 'update-headers',
            edits: [{ op: 'node.update', node: 'hook', set: { config: { options: { responseBody: { timeoutMs: 2000 } } } } }],
          },
          host,
        )
      ).operations,
    )
    expect(authoringNode(merged, 'hook').config).toMatchObject({
      options: {
        responseBody: { timeoutMs: 2000 },
        responseHeaders: { 'X-Fixed': 'kept' },
        responseHeadersSource: { kind: 'workflow-outputs' },
        responseHeaderOutputs: { 'X-Message': 'message' },
      },
    })
    const cleared = await compileAuthoring(
      merged,
      {
        baseRevision: 'base',
        requestId: 'clear',
        edits: [
          {
            op: 'node.update',
            node: 'hook',
            clear: [
              ['config', 'options', 'responseBody'],
              ['config', 'options', 'responseHeadersSource'],
              ['config', 'options', 'responseHeaderOutputs'],
            ],
          },
        ],
      },
      host,
    )
    expect(applyFlowChanges(merged, cleared.operations)).toEqual(original)
  })

  it('renames all Webhook selections atomically and leaves deleted fields diagnosable', () => {
    const original = content({ responseBody: { kind: 'workflow-outputs', output: 'message', timeoutMs: 2000 }, responseData: 'fixed' })
    const changes = updateOutputsDefs(original, 'outputs', [{ ...field, handle: 'renamed' }])
    const renamed = applyFlowChanges(original, changes)
    expect(authoringNode(renamed, 'hook').config).toMatchObject({ options: { responseBody: { output: 'renamed', timeoutMs: 2000 }, responseData: 'fixed' } })
    expect(applyFlowChanges(renamed, inverseFlowChanges(original, changes))).toEqual(original)
    const removed = applyFlowChanges(original, updateOutputsDefs(original, 'outputs', []))
    expect(authoringNode(removed, 'hook').config).toMatchObject({ options: { responseBody: { output: 'message' } } })
    expect(validateFlowGraph(removed)).toContainEqual(expect.objectContaining({ code: 'trigger.webhook-response-output-missing' }))
  })

  it('creates, reads, merges and clears dynamic response configuration through public authoring', async () => {
    const created = await compileAuthoring(
      content({ responseData: 'fixed', responseHeaders: { 'X-Test': 'preserved' } }),
      {
        baseRevision: 'base',
        requestId: 'create',
        edits: [{ op: 'node.update', node: 'hook', set: { config: { options: { responseBody: { kind: 'workflow-outputs', output: 'message' } } } } }],
      },
      host,
    )
    const updated = applyFlowChanges(content({ responseData: 'fixed', responseHeaders: { 'X-Test': 'preserved' } }), created.operations)
    expect(authoringNode(updated, 'hook').config).toMatchObject({
      options: { responseData: 'fixed', responseHeaders: { 'X-Test': 'preserved' }, responseBody: { kind: 'workflow-outputs', output: 'message' } },
    })
    const renamed = await compileAuthoring(
      updated,
      {
        baseRevision: 'base',
        requestId: 'rename',
        edits: [
          {
            op: 'node.update',
            node: 'outputs',
            set: { config: { outputDefs: { renamed: { schema: { type: 'string' }, nullable: false } } } },
            clear: [['config', 'outputDefs', 'message']],
          },
        ],
      },
      host,
    )
    const afterRename = applyFlowChanges(updated, renamed.operations)
    expect(authoringNode(afterRename, 'hook').config).toMatchObject({ options: { responseBody: { output: 'renamed' } } })
    const cleared = await compileAuthoring(
      afterRename,
      { baseRevision: 'base', requestId: 'clear', edits: [{ op: 'node.update', node: 'hook', clear: [['config', 'options', 'responseBody']] }] },
      host,
    )
    expect(authoringNode(applyFlowChanges(afterRename, cleared.operations), 'hook').config).toMatchObject({
      options: { responseData: 'fixed', responseHeaders: { 'X-Test': 'preserved' } },
    })
    expect(
      (authoringNode(applyFlowChanges(afterRename, cleared.operations), 'hook').config as unknown as { options: WebhookOptions }).options.responseBody,
    ).toBeUndefined()
  })
})
