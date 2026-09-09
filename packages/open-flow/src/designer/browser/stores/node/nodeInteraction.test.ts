import type { RFNode } from '../../base/rfHelpers.ts'

import { expect, it } from 'vitest'
import { createNodeInteraction } from './nodeInteraction.ts'

it('keeps selection and measurements when position changes, without duplicate position updates', () => {
  const initial = { id: 'm:test', type: 'task_node', position: { x: 10, y: 20 }, data: {}, measured: { width: 320, height: 80 } } as RFNode
  const state = createNodeInteraction(initial)
  const positions: unknown[] = []
  const stop = state.position.reaction((position) => positions.push(position), true)
  state.selected.set(true)
  state.position.set({ x: 30, y: 40 })
  state.position.set({ x: 30, y: 40 })
  expect(positions).toEqual([{ x: 30, y: 40 }])
  expect(state.rfNode.value).toMatchObject({ selected: true, measured: initial.measured, position: { x: 30, y: 40 } })
  stop()
  state.dispose()
})
