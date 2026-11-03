import type { CanvasDirection, FlowCanvasViewModel, FlowCanvasViewNode, ViewCallbacks } from '../../graph/FlowCanvas/model.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasStore } from './canvas.store.ts'

const stores: CanvasStore[] = []
afterEach(() => {
  for (const store of stores) store.dispose()
  stores.length = 0
})

async function setup(count = 10, direction?: CanvasDirection, overrides: Partial<ViewCallbacks> = {}, editable = true) {
  const model: FlowCanvasViewModel = {
    direction,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: Array.from(
      { length: count },
      (_, index): FlowCanvasViewNode => ({
        id: `step-${index}`,
        kind: 'task',
        title: `Step ${index}`,
        reference: 'code',
        inputs: [],
        outputs: [],
        position: { x: index * 400, y: 20 },
      }),
    ),
    edges: Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
      id: `edge-${index}`,
      source: `step-${index}`,
      target: `step-${index + 1}`,
      sourceHandle: '$out',
      targetHandle: '$in',
    })),
  }
  const onMoveNodes = vi.fn()
  const onChangeDirection = vi.fn(async (_direction: CanvasDirection, _positions: Readonly<Record<string, { x: number; y: number }>>) => true)
  const store = new CanvasStore(model, editable, 'en', { onMoveNodes, onChangeDirection, onChangeComment: undefined, ...overrides })
  stores.push(store)
  for (const node of store.$.nodes.values()) node.$$.rfNode.set({ ...node.$.rfNode.value, measured: { width: 336, height: 92 } })
  await Promise.resolve()
  return { store, model, onMoveNodes, onChangeDirection }
}

describe('canvas direction', () => {
  it('keeps legacy direction and saved positions when opening and reconciling a Flow', async () => {
    const { store, model, onMoveNodes, onChangeDirection } = await setup()
    expect(store.$.direction.value).toBe('horizontal')
    store.reconcile({ ...model, direction: 'vertical' }, true, 'en', [], [])
    expect(store.$.direction.value).toBe('vertical')
    expect([...store.$.nodes.values()].map((node) => node.$.position.value)).toEqual(model.nodes.map((node) => node.position))
    expect(onMoveNodes).not.toHaveBeenCalled()
    expect(onChangeDirection).not.toHaveBeenCalled()
  })

  it('lays out mixed-width vertical chains without wrapping and saves target measurements once', async () => {
    const { store, onMoveNodes, onChangeDirection } = await setup()
    store.changeDirection('vertical')
    const first = [...store.$.nodes.values()][0]!
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 742, height: 400 } })
    await Promise.resolve()
    expect(store.completeLayout(400)).toBe('relayout')
    expect(onChangeDirection).toHaveBeenCalledTimes(1)
    const positions = onChangeDirection.mock.calls[0]![1]
    const ordered = Array.from({ length: 10 }, (_, index) => positions[`step-${index}`]!)
    expect(ordered[1]!.y).toBeGreaterThanOrEqual(ordered[0]!.y + 480)
    for (let index = 1; index < ordered.length; index++) {
      expect(ordered[index]!.x + 336 / 2).toBe(ordered[0]!.x + 742 / 2)
      expect(ordered[index]!.y).toBeGreaterThan(ordered[index - 1]!.y)
    }
    expect(onMoveNodes).not.toHaveBeenCalled()
    expect(store.completeLayout(400)).toBe(true)
  })

  it('blocks repeated switches until saving completes and restores the model on failure', async () => {
    let finish!: (saved: boolean) => void
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    const { store, model } = await setup(2, 'horizontal', { onChangeDirection: save })
    store.changeDirection('vertical')
    store.completeLayout()
    store.changeDirection('horizontal')
    expect(store.$.direction.value).toBe('vertical')
    expect(store.$.changingDirection.value).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    finish(false)
    await Promise.resolve()
    expect(store.$.changingDirection.value).toBe(false)
    expect(store.$.direction.value).toBe('horizontal')
    expect([...store.$.nodes.values()].map((node) => node.$.position.value)).toEqual(model.nodes.map((node) => node.position))
  })

  it('saves direction on an empty canvas and does not commit a disposed canvas', async () => {
    const { store, onChangeDirection } = await setup(0)
    store.changeDirection('vertical')
    store.completeLayout()
    expect(onChangeDirection).toHaveBeenCalledWith('vertical', {})
    const next = await setup(0)
    next.store.changeDirection('vertical')
    next.store.dispose()
    expect(next.store.completeLayout()).toBe(true)
    expect(next.onChangeDirection).not.toHaveBeenCalled()
  })

  it('keeps read-only canvas directions immutable', async () => {
    const { store, onChangeDirection } = await setup(2, 'vertical', {}, false)
    store.changeDirection('horizontal')
    expect(store.$.direction.value).toBe('vertical')
    expect(onChangeDirection).not.toHaveBeenCalled()
  })

  it.each(['horizontal', 'vertical'] as const)('keeps %s branch lanes in output order for full and selected layouts', async (direction) => {
    const model: FlowCanvasViewModel = {
      direction,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'condition',
          kind: 'condition',
          title: 'Route',
          inputs: [],
          outputs: ['first', 'second', 'otherwise'].map((handle) => ({ handle })),
          cases: [],
          defaultOutput: 'otherwise',
          matchMode: 'first',
          position: { x: 0, y: 0 },
        },
        ...['first', 'second', 'otherwise', 'join'].map(
          (id): FlowCanvasViewNode => ({ id, kind: 'task', title: id, reference: 'code', inputs: [], outputs: [], position: { x: 0, y: 0 } }),
        ),
      ],
      edges: ['first', 'second', 'otherwise'].flatMap((id) => [
        { id: `condition-${id}`, source: 'condition', sourceHandle: `$branch:${id}`, target: id, targetHandle: '$in' },
        { id: `${id}-join`, source: id, sourceHandle: '$out', target: 'join', targetHandle: '$in' },
      ]),
    }
    const onMoveNodes = vi.fn()
    const store = new CanvasStore(model, true, 'en', { onMoveNodes, onChangeComment: undefined }, true)
    stores.push(store)
    for (const node of store.$.nodes.values())
      node.$$.rfNode.set({ ...node.$.rfNode.value, measured: { width: 336, height: node.nodeId === 'condition' ? 180 : 92 } })
    await Promise.resolve()
    store.completeLayout(5000)
    const positions = onMoveNodes.mock.calls[0]![0]
    const cross = direction === 'vertical' ? 'x' : 'y'
    expect(positions.first[cross]).toBeLessThan(positions.second[cross])
    expect(positions.second[cross]).toBeLessThan(positions.otherwise[cross])

    await store.handleNodesChange(
      store.$.rfNodes.value.map((node) => ({ type: 'select', id: node.id, selected: ['condition', 'first', 'otherwise'].includes(node.data.store.nodeId) })),
    )
    store.onRelayout(5000)
    const selectedPositions = onMoveNodes.mock.calls[1]![0]
    expect(Object.keys(selectedPositions).toSorted()).toEqual(['condition', 'first', 'otherwise'])
    expect(selectedPositions.first[cross]).toBeLessThan(selectedPositions.otherwise[cross])
    for (const id of ['second', 'join']) expect(store.$.rfNodes.value.find((node) => node.data.store.nodeId === id)?.position).toEqual(positions[id])
  })
})
