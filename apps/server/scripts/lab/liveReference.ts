import type { LiveDetails } from '@oomol-lab/open-flow/control-api'
import type { ToolCall } from './driver.ts'

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

/** All discovery and editing goes through caller-visible CLI commands. */
export async function referenceLive(call: ToolCall, flowId: string, dynamic = false) {
  if (dynamic) await call('flow_schema', { type: 'webhook' })
  const before = await call('flow_read', { flowId })
  const saved = await call('flow_edit', {
    flowId,
    baseRevision: before.revision,
    requestId: randomUUID(),
    edits: [
      {
        op: 'node.add',
        as: 'hook',
        type: 'webhook',
        name: 'Published hook',
        config: {
          method: 'POST',
          body: { message: { schema: { type: 'string' }, nullable: false } },
          ...(dynamic ? { options: { responseBody: { kind: 'workflow-outputs', output: 'message', timeoutMs: 30000 }, responseData: 'accepted' } } : {}),
        },
      },
      {
        op: 'node.add',
        as: 'echo',
        type: 'code',
        name: 'Echo',
        config: { outputs: { message: { schema: { type: 'string' }, nullable: false } } },
        inputs: { body: { kind: 'output', node: '$hook', port: 'body' } },
        code: 'export default ({body}) => ({message: body.message})',
      },
      { op: 'edge.connect', source: '$hook', target: '$echo' },
      ...(dynamic
        ? [
            {
              op: 'node.add',
              as: 'out',
              type: 'outputs',
              name: 'Outputs',
              config: { outputDefs: { message: { schema: { type: 'string' }, nullable: false } } },
              inputs: { message: { kind: 'output', node: '$echo', port: 'message' } },
            },
            { op: 'edge.connect', source: '$echo', target: '$out' },
          ]
        : []),
    ],
  })
  let revision = saved.revision
  if (dynamic) {
    const refs = saved.nodes as Record<string, string>
    const renamed = await call('flow_edit', {
      flowId,
      baseRevision: revision,
      requestId: randomUUID(),
      edits: [
        {
          op: 'node.update',
          node: refs.out,
          set: { config: { outputDefs: { reply: { schema: { type: 'string' }, nullable: false } } } },
          clear: [['config', 'outputDefs', 'message']],
        },
        { op: 'node.update', node: refs.hook, set: { config: { options: { responseBody: { timeoutMs: 15000 } } } } },
      ],
    })
    revision = renamed.revision
    await call('flow_read', { flowId, nodes: [refs.hook, refs.out] })
    const cleared = await call('flow_edit', {
      flowId,
      baseRevision: revision,
      requestId: randomUUID(),
      edits: [{ op: 'node.update', node: refs.hook, clear: [['config', 'options', 'responseBody']] }],
    })
    await call('flow_read', { flowId, nodes: [refs.hook] })
    const restored = await call('flow_edit', {
      flowId,
      baseRevision: cleared.revision,
      requestId: randomUUID(),
      edits: [
        { op: 'node.update', node: refs.hook, set: { config: { options: { responseBody: { kind: 'workflow-outputs', output: 'reply', timeoutMs: 15000 } } } } },
      ],
    })
    revision = restored.revision
    await call('flow_check', { flowId, revisionId: revision })
  }
  const published = await call('flow_publish', { flowId, revisionId: revision, expectedLivePublicationId: null, idempotencyKey: randomUUID() })
  if (published.warnings != null) throw new Error(`Unexpected publication warnings: ${JSON.stringify(published.warnings)}`)
  if (typeof published.operationId === 'string') {
    let operation = published
    const deadline = Date.now() + 10000
    while (operation.status === 'pending' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      operation = await call('flow_publish_status', { flowId, operationId: published.operationId })
    }
    if (operation.status !== 'succeeded') throw new Error(`Publication did not succeed: ${JSON.stringify(operation)}`)
  }
  async function readLive() {
    const result = await call('flow_live', { flowId })
    return (result.live ?? result) as LiveDetails
  }
  const live = published.live == null ? await readLive() : (published.live as LiveDetails)
  const hook = live.entries.find((entry) => entry.type == 'webhook')
  if (hook?.type != 'webhook' || !hook.binding.endpointUrl || hook.config.method != 'POST' || !hook.config.body.message)
    throw new Error('Publish did not expose the Webhook contract')
  const queried = await readLive()
  if (!isDeepStrictEqual(queried, live)) throw new Error('Publish and live disagree')
  await call('flow_edit', {
    flowId,
    baseRevision: revision,
    requestId: randomUUID(),
    edits: [{ op: 'node.update', node: hook.nodeId, set: { name: 'Draft hook', config: { method: 'PUT' } } }],
  })
  const after = await readLive()
  if (!isDeepStrictEqual(after, live)) throw new Error('Draft edit changed online entries')
}
