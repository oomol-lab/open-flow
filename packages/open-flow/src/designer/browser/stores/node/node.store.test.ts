import type { NodeId } from '../../../../schema/index.ts'
import type { NodeContent } from '../../graph/FlowDesigner/nodeContent.ts'

import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { NODE_TYPE } from './constants.ts'
import { NodeStore } from './node.store.ts'

const content: NodeContent = { id: 'node', kind: 'task', title: 'Task', reference: 'task', inputs: [], outputs: [] }

function setup() {
  const content$ = val<NodeContent>(content)
  const node = new NodeStore('node' as NodeId, NODE_TYPE.TaskNode, { ignoredNodeIds: val([]), content$, position: { x: 0, y: 0 } })
  return { node, content$ }
}

describe('NodeStore', () => {
  it('disposes owned content once', () => {
    const { node, content$ } = setup()
    const dispose = vi.spyOn(content$, 'dispose')
    node.dispose()
    node.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('reflects diagnostics without replacing interaction state', () => {
    const { node, content$ } = setup()
    node.$$.position.set({ x: 21, y: 34 })
    node.$$.selected.set(true)
    expect(node.$.hasError.value).toBe(false)
    content$.set({ ...content, diagnostics: 2 })
    expect(node.$.hasError.value).toBe(true)
    expect(node.$.position.value).toEqual({ x: 21, y: 34 })
    expect(node.$.selected.value).toBe(true)
    content$.set(content)
    expect(node.$.hasError.value).toBe(false)
    node.dispose()
  })
})
