import type { Graph } from '../src/flow/common/change.ts'

import { expect, it } from 'vitest'
import { Dependencies } from '../src/execution/common/dependencies.ts'

function graph(ids: readonly string[], edges: Graph['edges']): Graph {
  return {
    nodes: {
      start: { kind: 'manual', name: 'Start' },
      ...Object.fromEntries(ids.map((id) => [id, { kind: 'value' as const, inputs: {}, values: [] }])),
    },
    edges,
  }
}

it('propagates skipped branches before admitting a join regardless of node order', () => {
  const dependencies = new Dependencies(
    graph(
      ['aJoin', 'bSkipped', 'cBranch', 'zSelected'],
      [
        { source: 'start', target: 'cBranch' },
        { source: 'cBranch', sourceHandle: 'yes', target: 'zSelected' },
        { source: 'cBranch', sourceHandle: 'no', target: 'bSkipped' },
        { source: 'bSkipped', target: 'aJoin' },
        { source: 'zSelected', target: 'aJoin' },
      ],
    ),
  )
  dependencies.start('start', {})
  expect(dependencies.ready()).toEqual(['cBranch'])
  dependencies.begin('cBranch', 'branch')
  dependencies.release('cBranch', { yes: 42 }, ['yes'], true)
  expect(dependencies.ready()).toEqual(['zSelected'])
  dependencies.begin('zSelected', 'selected')
  dependencies.release('zSelected', { answer: 42 }, ['answer'], true)
  expect(dependencies.ready()).toEqual(['aJoin'])
  expect(dependencies.ready()).toEqual(['aJoin'])
  expect(dependencies.state.nodes.aJoin!.previous).toEqual(['zSelected'])
  expect(dependencies.state.nodes.aJoin!.input.bSkipped).toBeUndefined()
  dependencies.begin('aJoin', 'join')
  dependencies.release('aJoin', {}, [], true)
  expect(dependencies.ready()).toEqual([])
  expect(dependencies.incomplete).toBe(false)
})

it('restores partial releases and preserves the input snapshot of an admitted consumer', () => {
  const source = graph(
    ['producer', 'early', 'late'],
    [
      { source: 'start', target: 'producer' },
      { source: 'producer', sourceHandle: 'pending', target: 'early' },
      { source: 'producer', sourceHandle: 'done', target: 'late' },
    ],
  )
  const first = new Dependencies(source)
  first.start('start', {})
  expect(first.ready()).toEqual(['producer'])
  first.begin('producer', 'waiting')
  first.release('producer', { pending: 'notification' }, ['pending'], false)
  expect(first.ready()).toEqual(['early'])
  first.begin('early', 'early')
  first.release('early', {}, [], true)
  const restored = new Dependencies(source, JSON.parse(JSON.stringify(first.state)))
  expect(restored.ready()).toEqual([])
  restored.release('producer', { done: 'approved' }, ['done'], true)
  expect(restored.ready()).toEqual(['late'])
  expect(restored.state.nodes.early!.input.producer!.outputs).toEqual({ pending: 'notification' })
  expect(restored.state.nodes.late!.input.producer!.outputs).toEqual({ done: 'approved' })
})

it('retains both selected handles when a diamond rejoins the same invocation', () => {
  const dependencies = new Dependencies(
    graph(
      ['producer', 'left', 'right', 'join'],
      [
        { source: 'start', target: 'producer' },
        { source: 'producer', sourceHandle: 'left', target: 'left' },
        { source: 'producer', sourceHandle: 'right', target: 'right' },
        { source: 'left', target: 'join' },
        { source: 'right', target: 'join' },
      ],
    ),
  )
  dependencies.start('start', {})
  expect(dependencies.ready()).toEqual(['producer'])
  dependencies.begin('producer', 'producer')
  dependencies.release('producer', { left: 1, right: 2 }, ['left', 'right'], true)
  expect(dependencies.ready()).toEqual(['left', 'right'])
  for (const id of ['left', 'right']) {
    dependencies.begin(id, id)
    dependencies.release(id, {}, [], true)
  }
  expect(dependencies.ready()).toEqual(['join'])
  expect(dependencies.state.nodes.join!.input.producer!.outputs).toEqual({ left: 1, right: 2 })
})

it('resolves distant ancestors in a long chain and restores the same checkpoint values', () => {
  const ids = Array.from({ length: 400 }, (_, index) => `node${index}`)
  const source = graph(
    ids,
    ids.map((target, index) => ({ source: ids[index - 1] ?? 'start', target })),
  )
  const dependencies = new Dependencies(source)
  dependencies.start('start', { seed: 42 })
  for (const id of ids) {
    expect(dependencies.ready()).toEqual([id])
    expect(dependencies.input(id, 'start')?.outputs).toEqual({ seed: 42 })
    dependencies.begin(id, id)
    dependencies.release(id, { value: id }, ['value'], true)
  }
  expect(dependencies.ready()).toEqual([])
  const saved = JSON.parse(JSON.stringify(dependencies.state))
  const restored = new Dependencies(source, saved)
  expect(restored.ready()).toEqual([])
  expect(restored.incomplete).toBe(false)
  expect(restored.input('node399', 'node0')?.outputs).toEqual({ value: 'node0' })
  expect(restored.input('node399', 'start')?.outputs).toEqual({ seed: 42 })
})
