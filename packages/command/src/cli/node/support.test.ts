import { createCodeTask } from '@oomol-lab/open-flow/flow-authoring'
import { applyFlowChanges } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it } from 'vitest'
import { applySpec } from './support.ts'

describe('Flow apply Code Actions', () => {
  const capabilities = [{ kind: 'connector', action: 'example.echo', connections: [{ connectionId: 'work', alias: 'office' }], connectionId: 'work' }]

  it('preserves declarations through the CLI spec and public authoring operations', () => {
    const spec = applySpec(JSON.stringify({ version: 1, nodes: { code: { kind: 'code', name: 'Code', code: '@main.js', capabilities } } }))
    const node = spec.nodes.code
    if (node?.kind != 'code') throw new Error('Expected Code node.')
    const content = applyFlowChanges(
      { modelVersion: 1, modules: {}, document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: {} } } },
      createCodeTask({ kind: 'flow' }, { moduleId: 'main', nodeId: 'code' }, node.name, undefined, {
        inputs: [],
        outputs: [],
        capabilities: node.capabilities,
      }),
    )
    expect(content.document.graph.nodes.code).toMatchObject({ task: { capabilities } })
  })

  it.each([null, [{ ...capabilities[0], connectionId: 'missing' }], [{ ...capabilities[0], extra: true }]])('rejects malformed declarations %j', (value) => {
    expect(() => applySpec(JSON.stringify({ version: 1, nodes: { code: { kind: 'code', name: 'Code', code: '@main.js', capabilities: value } } }))).toThrow(
      /capabilities/,
    )
  })
})

it('normalizes option syntax without rewriting values that resemble options', async () => {
  const { parseArguments } = await import('./support.ts')
  expect(parseArguments(['code', 'edit', 'flow', 'module', '--code', '--x=y']).code).toBe('--x=y')
  expect(parseArguments(['code', 'edit', 'flow', 'module', '--code=--x=y']).code).toBe('--x=y')
  expect(() => parseArguments(['list', '--json=true'])).toThrow(/does not accept a value/)
})
