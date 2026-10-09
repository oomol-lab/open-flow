import type { SchedulerEvent, TaskInvocation } from '../../execution/common/scheduler.ts'
import type { JsonValue, RevisionContent } from '../../flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { currentEngineContract } from '../../execution/common/engineContract.ts'
import { runFlow } from '../../execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { prepareFlow } from '../../flow/common/semantics.ts'
import { openApiTask, selectOperation } from './openapi.ts'

it('resolves authentication sources privately, keeps defaults and omits explicitly unset optional parameters', async () => {
  const doc = {
    openapi: '3.1.0',
    paths: {
      '/items': {
        get: {
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 2 } },
          ],
          responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
  }
  const task = openApiTask({
    ...selectOperation(doc, 'https://api.example.test/spec', '/items', 'get'),
    auth: [
      { id: 'bearer', type: 'bearer' },
      { id: 'key', type: 'apiKey', in: 'query', name: 'key' },
    ],
  })
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: { key: { kind: 'variable', target: 'API_KEY' } },

      graph: {
        edges: [
          { source: 'start', target: 'upstream' },
          { source: 'upstream', target: 'api' },
        ],
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          upstream: {
            kind: 'value',
            name: 'Token',
            inputs: {},
            values: [{ handle: 'token', value: 'upstream-secret', jsonSchema: { type: 'string' }, nullable: false }],
          },
          api: {
            kind: 'task',
            name: 'API',
            task: task,
            inputs: {
              'query.limit': { kind: 'unset' },
              'auth.bearer.token': { kind: 'sources', sources: [{ kind: 'node', nodeId: 'upstream', output: 'token' }] },
              'auth.key.token': { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'key' }] },
            },
          },
        },
      },
    },
  }
  const prepared = await prepareFlow(content, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const events: SchedulerEvent[] = []
  let input: Readonly<Record<string, JsonValue>> = {}
  let identity = 0
  await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => String(++identity),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      bindingValues: { key: 'variable-secret' },
      emit: (event) =>
        Effect.sync(() => {
          events.push(event)
        }),
      invokeTask: (invocation: TaskInvocation) =>
        Effect.sync(() => {
          input = invocation.input
          return { body: {}, statusCode: 200, headers: {} }
        }),
    }),
  )
  expect(input).toEqual({ 'query.page': 2, 'auth.bearer.token': 'upstream-secret', 'auth.key.token': 'variable-secret' })
  const started = events.find((event) => event.type == 'node.started' && event.nodeId == 'api')
  expect(started).toMatchObject({ nodeKind: 'openapi', inputs: { 'query.limit': null, 'query.page': 2 } })
  expect(JSON.stringify(started)).not.toContain('secret')
})
