import type { Viewport, Rect } from '@xyflow/react'
import type { ReadonlyVal } from 'value-enhancer'
import type { NodeId } from '../../../../schema/index.ts'
import type { Size } from '../../base/compare.ts'
import type { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'

import { useState, useEffect, createContext, useContext } from 'react'
import { compute } from 'value-enhancer'
import { isRectIntersect } from '../../base/rfHelpers.ts'
import { usePaneRect$ } from './usePaneRect.ts'

export class NodePlaceholderQueue {
  /** Delays updates while the canvas is moving. */
  static readonly debounce = 0

  /** Controls how often another node is updated. */
  static readonly interval = 100

  private readonly queue: NodeId[] = []
  private readonly map = new Map<NodeId, () => void>()

  private delayTimer = 0
  delay(ms: number): void {
    if (ms === 0 && this.delayTimer) return
    clearTimeout(this.delayTimer)
    this.delayTimer = window.setTimeout(() => {
      this.delayTimer = 0
      this.pop()
    }, ms)
  }

  set(nodeId: NodeId, cb: () => void): void {
    if (!this.map.has(nodeId)) {
      this.queue.push(nodeId)
    }
    this.map.set(nodeId, cb)
    if (this.delayTimer) return
    this.delay(NodePlaceholderQueue.interval)
  }

  delete(nodeId: NodeId): void {
    this.map.delete(nodeId)
    const index = this.queue.indexOf(nodeId)
    if (index >= 0) {
      this.queue.splice(index, 1)
    }
  }

  private pop() {
    const nodeId = this.queue.shift()
    let cb: (() => void) | undefined
    if (nodeId && (cb = this.map.get(nodeId))) {
      cb()
      this.map.delete(nodeId)
      if (this.queue.length) {
        this.delay(Math.random() * NodePlaceholderQueue.interval)
      }
    } else if (this.queue.length) {
      this.pop()
    }
  }

  dispose(): void {
    clearTimeout(this.delayTimer)
    this.map.clear()
  }
}

export const NodePlaceholder: React.Context<NodePlaceholderQueue> = /*#__PURE__*/ createContext<NodePlaceholderQueue>(null!)

/** Returns a size for an off-screen node and `undefined` for a visible node. */
export function useNodePlaceholder(viewport$: ReadonlyVal<Viewport | undefined>, nodeStore: NodeStore | CommentNodeStore): Size | undefined {
  const paneRect$ = usePaneRect$()
  const queue = useContext(NodePlaceholder)
  const [placeholder, setPlaceholder] = useState<Size>()

  useEffect(() => {
    const $ = nodeStore.$

    const placeholder$ = compute<Size | undefined>((get) => {
      if (get($.selected)) return undefined

      // Keep every node visible until React Flow has measured it.
      const measured = get($.measured)
      if (!measured || !measured.width || !measured.height) return
      const { width, height } = measured as Size

      const paneRect = get(paneRect$)

      // Replace only nodes outside the current viewport with placeholders.
      const { x, y } = get($.position)
      const nodeRect: Rect = { x, y, width, height }

      return isRectIntersect(paneRect, nodeRect) ? undefined : (measured as Size)
    })

    // Pause placeholder changes while the viewport is moving.
    const stopListenViewport = viewport$.reaction(() => {
      queue.delay(NodePlaceholderQueue.debounce)
    })

    const stopListenPlaceholder = placeholder$.subscribe((nextPlaceholder) => {
      queue.set(nodeStore.nodeId, () => setPlaceholder(nextPlaceholder))
    })

    return () => {
      queue.delete(nodeStore.nodeId)
      stopListenPlaceholder()
      stopListenViewport()
    }
  }, [viewport$, paneRect$, nodeStore])

  return placeholder
}
