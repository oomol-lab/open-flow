import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { parse } from 'yaml'
import { ExecutorSchema, FlowSchema, SubflowBlockSchema, TaskBlockSchema } from '../src/schema/index.ts'

describe('Workflow schema', () => {
  it('parses a flow manifest', () => {
    const source = `
nodes: []
`

    assert.deepEqual(FlowSchema.parse(parse(source)), { nodes: [] })
  })

  it('parses a subflow block manifest with its schema defaults', () => {
    const source = `
inputs_def:
  - handle: input
nodes:
  - node_id: task
    task: self::task
outputs_def:
  - handle: output
outputs_from:
  - handle: output
    from_node:
      - node_id: task
        output_handle: output
`

    assert.deepEqual(SubflowBlockSchema.parse(parse(source)), {
      inputs_def: [{ handle: 'input' }],
      nodes: [{ node_id: 'task', task: 'self::task', progress_weight: 1 }],
      outputs_def: [{ handle: 'output' }],
      outputs_from: [{ handle: 'output', from_node: [{ node_id: 'task', output_handle: 'output' }] }],
      private: false,
    })
  })

  it('rejects unknown fields at descriptor boundaries', () => {
    const sources = [
      'unknown: true\nnodes: []\n',
      'nodes:\n  - node_id: value\n    values: []\n    unknown: true\n',
      'nodes:\n  - node_id: task\n    task: self::task\n    inputs_from:\n      - handle: input\n        unknown: true\n',
    ]
    for (const source of sources) assert.throws(() => FlowSchema.parse(parse(source)), /Unrecognized key/)
  })

  it('accepts only the current strict executor contracts', () => {
    assert.deepEqual(ExecutorSchema.parse({ name: 'connector', options: { action: 'gmail.send_email', connection: 'gmail-work' } }), {
      name: 'connector',
      options: { action: 'gmail.send_email', connection: 'gmail-work' },
    })
    assert.deepEqual(ExecutorSchema.parse({ name: 'javascript', options: { entry: 'task.ts', function: 'run' } }), {
      name: 'javascript',
      options: { entry: 'task.ts', function: 'run' },
    })
    assert.throws(() => ExecutorSchema.parse({ name: 'connector', options: {} }))
    assert.throws(() => ExecutorSchema.parse({ name: 'connector', options: { action: 'gmail.send_email', connection: 'gmail-work', entry: 'task.ts' } }))
    assert.throws(() => ExecutorSchema.parse({ name: 'javascript', options: {} }))
    assert.throws(() => ExecutorSchema.parse({ name: 'javascript', options: { entry: 'task.ts', spawn: true } }))
    for (const name of ['nodejs', 'python', 'shell']) assert.throws(() => ExecutorSchema.parse({ name, options: { entry: 'task.ts' } }))
  })

  it('accepts only local shared block references', () => {
    assert.doesNotThrow(() => FlowSchema.parse({ nodes: [{ node_id: 'task', task: 'self::task' }] }))
    for (const task of ['package::task', './task.oo.yaml', 'self::../task']) {
      assert.throws(() => FlowSchema.parse({ nodes: [{ node_id: 'task', task }] }))
    }
  })

  it('keeps default node widths on reusable blocks', () => {
    const executor = { name: 'javascript' as const, options: { entry: 'task.ts' } }
    const ui = { default_width: 450 }
    assert.deepEqual(TaskBlockSchema.parse({ executor, ui }), { executor, ui, private: false })
    assert.deepEqual(SubflowBlockSchema.parse({ nodes: [], ui }), { nodes: [], ui, private: false })
    assert.throws(() => FlowSchema.parse({ nodes: [{ node_id: 'task', task: { executor, ui } }] }), /Unrecognized key/)
  })

  it('keeps running fields on executable node kinds only', () => {
    assert.deepEqual(
      FlowSchema.parse({
        nodes: [{ node_id: 'task', task: 'self::task', timeout: 0.25, progress_weight: 3 }],
      }),
      { nodes: [{ node_id: 'task', task: 'self::task', timeout: 0.25, progress_weight: 3 }] },
    )
    assert.deepEqual(
      FlowSchema.parse({
        nodes: [{ node_id: 'condition', progress_weight: 2, inputs_def: [], conditions: { cases: [] } }],
      }),
      { nodes: [{ node_id: 'condition', progress_weight: 2, inputs_def: [], conditions: { cases: [] } }] },
    )
    assert.deepEqual(FlowSchema.parse({ nodes: [{ node_id: 'value', ignore: true, icon: 'value.svg', values: [] }] }), {
      nodes: [{ node_id: 'value', ignore: true, icon: 'value.svg', values: [] }],
    })
    assert.throws(() =>
      FlowSchema.parse({
        nodes: [{ node_id: 'condition', timeout: 1, inputs_def: [], conditions: { cases: [] } }],
      }),
    )
    for (const concurrency of [0, 1.5]) {
      assert.throws(() =>
        FlowSchema.parse({
          nodes: [{ node_id: 'condition', concurrency, inputs_def: [], conditions: { cases: [] } }],
        }),
      )
    }
    for (const field of ['timeout', 'concurrency', 'progress_weight']) {
      assert.throws(() => FlowSchema.parse({ nodes: [{ node_id: 'value', values: [], [field]: 1 }] }))
    }
    const executor = { name: 'javascript', options: { entry: 'task.ts' } }
    assert.throws(() => TaskBlockSchema.parse({ executor, timeout: 1 }))
    assert.throws(() => SubflowBlockSchema.parse({ nodes: [], outputs_from: [], timeout: 1 }))
  })
})
