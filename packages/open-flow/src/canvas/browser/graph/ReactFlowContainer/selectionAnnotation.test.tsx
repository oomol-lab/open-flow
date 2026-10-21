// @vitest-environment happy-dom
import type { NodeId } from '../../../../schema/index.ts'
import type { RFNode } from '../../base/rfHelpers.ts'
import type { NodeContent } from '../FlowCanvas/nodeContent.ts'

import { val } from 'value-enhancer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render as mount } from '../../../../../test/support/render.tsx'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { NODE_TYPE } from '../../stores/node/constants.ts'
import { NodeStore } from '../../stores/node/node.store.ts'
import { CanvasAnnotationContext } from '../annotations.tsx'
import { SelectionAnnotation } from './selectionAnnotation.tsx'

const hooks = vi.hoisted(() => ({
  state: { domNode: { querySelector: vi.fn() }, nodesSelectionActive: true, userSelectionActive: false },
}))
vi.mock('@xyflow/react', () => ({ useStore: (select: (state: typeof hooks.state) => unknown) => select(hooks.state) }))
const stores: (NodeStore | CommentNodeStore)[] = []
function node(id: string): RFNode {
  const content: NodeContent = { id, title: id, kind: 'task', reference: 'task', inputs: [], outputs: [] }
  const store = new NodeStore(id as NodeId, NODE_TYPE.TaskNode, { content$: val<NodeContent>(content), ignoredNodeIds: val([]), position: { x: 0, y: 0 } })
  stores.push(store)
  return store.$.rfNode.value
}
let mounted: ReturnType<typeof mount> | undefined
function cleanup() {
  mounted?.unmount()
  mounted = undefined
}
function render(nodes: RFNode[], context: CanvasAnnotationContext | undefined = { flowId: 'flow', revisionId: 'r1', syncState: 'saved' }) {
  const element = (
    <CanvasAnnotationContext.Provider value={context}>
      <SelectionAnnotation nodes={nodes} />
    </CanvasAnnotationContext.Provider>
  )
  if (mounted == null) mounted = mount(element)
  else mounted.rerender(element)
}

describe('React Flow selection annotations', () => {
  let rectangle: HTMLDivElement
  const attributes = { get: (key: string) => rectangle.getAttribute(key), set: (key: string, value: string) => rectangle.setAttribute(key, value) }
  beforeEach(() => {
    rectangle = document.createElement('div')
    mounted = undefined
    hooks.state.nodesSelectionActive = true
    hooks.state.userSelectionActive = false
    hooks.state.domNode.querySelector.mockReturnValue(rectangle)
  })
  afterEach(() => {
    cleanup()
    for (const store of stores.splice(0)) store.dispose()
  })

  it('annotates the existing rectangle with business IDs and updates the captured context', () => {
    const a = node('a'),
      b = node('b'),
      c = node('c')
    render([a, b])
    expect(attributes.get('oai-annotatable')).toBe(mounted!.i18n.t('annotation.selectedNodes', { count: 2 }))
    expect(JSON.parse(attributes.get('oai-annotation-metadata')!)).toMatchObject({ nodeIds: '["a","b"]', revisionId: 'r1' })
    cleanup()
    render([b, c], { flowId: 'flow', revisionId: 'r2', syncState: 'dirty' })
    expect(JSON.parse(attributes.get('oai-annotation-metadata')!)).toMatchObject({ nodeIds: '["b","c"]', revisionId: 'r2', syncState: 'dirty' })
    cleanup()
    render([b])
    expect(rectangle.hasAttribute('oai-annotation-metadata')).toBe(false)
  })

  it('does not annotate a live selection gesture or a mixed business/comment selection', () => {
    const a = node('a'),
      b = node('b')
    hooks.state.userSelectionActive = true
    render([a, b])
    expect(rectangle.hasAttribute('oai-annotation-metadata')).toBe(false)
    hooks.state.userSelectionActive = false
    const comment = new CommentNodeStore('comment' as NodeId, { position: { x: 0, y: 0 }, onSaveContent: () => {} })
    stores.push(comment)
    render([a, comment.$.rfNode.value])
    expect(rectangle.hasAttribute('oai-annotation-metadata')).toBe(false)
  })

  it('tolerates an absent rectangle and leaves other DOM attributes unchanged on cleanup', () => {
    const nodes = [node('a'), node('b')]
    attributes.set('tabindex', '-1')
    render(nodes)
    cleanup()
    expect(rectangle.getAttributeNames()).toEqual(['tabindex'])
    expect(rectangle.tabIndex).toBe(-1)
    hooks.state.domNode.querySelector.mockReturnValue(null)
    expect(() => render(nodes)).not.toThrow()
  })
})
