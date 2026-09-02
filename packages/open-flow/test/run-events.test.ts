import { describe, expect, it } from 'vitest'
import { createEventProjector as createProjector } from '../src/execution/common/events.ts'

const runId = '019f0000-0001-7000-8000-000000000001'
const nestedRunId = '019f0000-0001-7000-8000-000000000002'
const invalidOrderRunId = '019f0000-0001-7000-8000-000000000003'
const failureCodes: ReadonlySet<string> = new Set(['connector.connection-required', 'connector.unavailable', 'node.failed'])

function createEventProjector(platformRunId: string) {
  return createProjector(platformRunId, failureCodes)
}

describe('Runtime event projector', () => {
  it('maps Runtime identities deterministically without exposing raw run or job IDs', async () => {
    const project = createEventProjector(runId)
    const started = await project({
      flowId: 'flows/hello-world/flow.oo.yaml',
      parentJobId: undefined,
      parentRunId: undefined,
      runId: 'runtime-root',
      type: 'run.started',
    })
    const node = await project({
      connection: 'not-public',
      inputs: { hidden: 'input' },
      jobId: 'runtime-job',
      nodeId: 'greet',
      nodeKind: 'connector',
      nodeTitle: 'Greet user',
      operation: 'test.echo',
      runId: 'runtime-root',
      type: 'node.started',
    })

    expect(started).toEqual({
      kind: 'run.started',
      payload: {
        flowId: 'flows/hello-world/flow.oo.yaml',
        scopeId: expect.stringMatching(/^scope_[0-9a-f]{32}$/),
      },
    })
    expect(node).toEqual({
      kind: 'node.started',
      payload: {
        executionId: expect.stringMatching(/^execution_[0-9a-f]{32}$/),
        flowId: 'flows/hello-world/flow.oo.yaml',
        nodeId: 'greet',
        nodeKind: 'connector',
        nodeTitle: 'Greet user',
        operation: 'test.echo',
        scopeId: started!.payload.scopeId,
      },
    })
    expect(JSON.stringify([started, node])).not.toContain('runtime-root')
    expect(JSON.stringify([started, node])).not.toContain('runtime-job')
    expect(JSON.stringify(node)).not.toContain('hidden')
    expect(JSON.stringify(node)).not.toContain('not-public')

    const replay = createEventProjector(runId)
    expect(
      await replay({
        flowId: 'flows/hello-world/flow.oo.yaml',
        runId: 'runtime-root',
        type: 'run.started',
      }),
    ).toEqual(started)
    expect(
      await replay({
        jobId: 'runtime-job',
        nodeId: 'greet',
        nodeKind: 'connector',
        nodeTitle: 'Greet user',
        operation: 'test.echo',
        runId: 'runtime-root',
        type: 'node.started',
      }),
    ).toEqual(node)
  })

  it('accepts node.started events from older Runtime packages without display metadata', async () => {
    const project = createEventProjector(runId)
    await project({ flowId: 'flows/legacy/flow.oo.yaml', runId: 'legacy-runtime-run', type: 'run.started' })

    expect(await project({ jobId: 'legacy-job', nodeId: 'legacy-node', runId: 'legacy-runtime-run', type: 'node.started' })).toMatchObject({
      kind: 'node.started',
      payload: {
        nodeId: 'legacy-node',
      },
    })
  })

  it('projects Wait node metadata without exposing its input', async () => {
    const project = createEventProjector(runId)
    await project({ flowId: 'flows/wait/flow.oo.yaml', runId: 'runtime-run', type: 'run.started' })

    const event = await project({
      inputs: { value: 'private' },
      jobId: 'wait-job',
      nodeId: 'approval',
      nodeKind: 'wait',
      nodeTitle: 'Approval',
      runId: 'runtime-run',
      type: 'node.started',
    })

    expect(event).toMatchObject({ kind: 'node.started', payload: { nodeId: 'approval', nodeKind: 'wait', nodeTitle: 'Approval' } })
    expect(JSON.stringify(event)).not.toContain('private')
  })

  it('samples node and run progress once per integer percentage bucket', async () => {
    const project = createEventProjector(runId)
    await project({ flowId: 'flows/progress/flow.oo.yaml', runId: 'runtime-run', type: 'run.started' })
    const progress = async (value: number, jobId = 'job') =>
      await project({ jobId, nodeId: 'progress', progress: value, runId: 'runtime-run', type: 'node.progress' })
    const runProgress = async (value: number) => await project({ progress: value, runId: 'runtime-run', type: 'run.progress' })

    expect(await progress(0.1)).toMatchObject({ kind: 'node.progress', payload: { progress: 0.1 } })
    expect(await progress(0.9)).toBeUndefined()
    expect(await progress(1)).toMatchObject({ kind: 'node.progress', payload: { progress: 1 } })
    expect(await progress(1.8)).toBeUndefined()
    expect(await progress(2.4)).toMatchObject({ kind: 'node.progress', payload: { progress: 2.4 } })
    expect(await progress(1.9)).toBeUndefined()
    expect(await progress(100)).toMatchObject({ kind: 'node.progress', payload: { progress: 100 } })
    expect(await progress(0.9, 'another-job')).toMatchObject({ kind: 'node.progress', payload: { progress: 0.9 } })

    expect(await runProgress(0.1)).toMatchObject({ kind: 'run.progress', payload: { progress: 0.1 } })
    expect(await runProgress(0.9)).toBeUndefined()
    expect(await runProgress(1)).toMatchObject({ kind: 'run.progress', payload: { progress: 1 } })
    expect(await runProgress(0.5)).toBeUndefined()
  })

  it('projects nested scope, progress, Artifact, and redacted log fields only', async () => {
    const project = createEventProjector(nestedRunId)
    const root = await project({
      flowId: 'flows/root/flow.oo.yaml',
      runId: 'root-runtime-run',
      type: 'run.started',
    })
    const nested = await project({
      flowId: 'subflows/child/subflow.oo.yaml',
      parentJobId: 'parent-job',
      parentRunId: 'root-runtime-run',
      runId: 'nested-runtime-run',
      type: 'run.started',
    })
    const progress = await project({
      progress: 0.5,
      runId: 'nested-runtime-run',
      type: 'run.progress',
    })
    const log = await project({
      data: { authorization: 'not-public' },
      jobId: 'nested-job',
      level: 'info',
      message: 'authorization=secret-value Bearer bearer-value',
      nodeId: 'child',
      runId: 'nested-runtime-run',
      type: 'node.log',
    })
    const artifact = await project({
      artifact: {
        digest: `sha256:${'a'.repeat(64)}`,
        id: 'artifact-1',
        kind: 'artifact',
        mediaType: 'text/plain',
        name: 'result.txt',
        size: 12,
      },
      jobId: 'nested-job',
      nodeId: 'child',
      runId: 'nested-runtime-run',
      type: 'node.artifact',
    })

    expect(nested).toMatchObject({
      kind: 'run.started',
      payload: {
        parentScopeId: root!.payload.scopeId,
      },
    })
    expect(progress).toMatchObject({
      kind: 'run.progress',
      payload: {
        flowId: 'subflows/child/subflow.oo.yaml',
        progress: 0.5,
        scopeId: nested!.payload.scopeId,
      },
    })
    expect(log).toMatchObject({
      kind: 'node.log',
      payload: {
        level: 'info',
        message: 'authorization=[REDACTED] Bearer [REDACTED]',
      },
    })
    expect(JSON.stringify(log)).not.toContain('not-public')
    expect(artifact).toMatchObject({
      kind: 'node.artifact',
      payload: {
        artifact: {
          id: 'artifact-1',
          kind: 'artifact',
          name: 'result.txt',
        },
      },
    })
  })

  it('preserves supported node failure categories and rejects unsupported codes', async () => {
    const project = createEventProjector(runId)
    await project({ flowId: 'flows/failure/flow.oo.yaml', runId: 'runtime-run', type: 'run.started' })
    const failed = await project({
      code: 'connector.unavailable',
      jobId: 'job',
      message: 'The managed request failed with token=private.',
      nodeId: 'connector',
      runId: 'runtime-run',
      type: 'node.failed',
    })

    expect(failed).toMatchObject({
      kind: 'node.failed',
      payload: { error: { code: 'connector.unavailable', message: 'The managed request failed with token=[REDACTED]' } },
    })
    await expect(
      project({ code: 'provider.raw-error', jobId: 'job', message: 'private', nodeId: 'connector', runId: 'runtime-run', type: 'node.failed' }),
    ).rejects.toThrow('Runtime node.failed code is invalid.')
  })

  it('projects node outputs without duplicating completed outputs and rejects unknown event types or invalid ordering', async () => {
    const project = createEventProjector(invalidOrderRunId)

    await expect(
      project({
        jobId: 'job',
        nodeId: 'node',
        runId: 'runtime-run',
        type: 'node.started',
      }),
    ).rejects.toThrow('preceded its run.started')
    await project({ flowId: 'flows/output/flow.oo.yaml', runId: 'runtime-run', type: 'run.started' })
    const output = await project({
      handle: 'result',
      jobId: 'job',
      nodeId: 'node',
      runId: 'runtime-run',
      type: 'node.output',
      value: { visible: true },
    })
    expect(output).toMatchObject({
      kind: 'node.output',
      payload: { handle: 'result', nodeId: 'node' },
      value: { visible: true },
    })
    expect(
      await project({
        jobId: 'job',
        nodeId: 'node',
        outputs: { result: { duplicated: true } },
        runId: 'runtime-run',
        type: 'node.completed',
      }),
    ).not.toHaveProperty('payload.outputs')
    await expect(project({ runId: 'runtime-run', type: 'runtime.future-event' })).rejects.toThrow('is not supported')
  })
})
