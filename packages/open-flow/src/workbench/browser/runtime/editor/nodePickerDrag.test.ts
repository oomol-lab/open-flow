import type { AddNodeOption } from './addNodeOptions.ts'

import { describe, expect, it, vi } from 'vitest'
import { NodePickerDragSession } from './nodePickerDrag.ts'

const option: AddNodeOption = {
  id: 'task',
  description: 'Run a task.',
  kind: 'new-task',
  group: 'Blocks',
  label: 'Task',
  inputs: [],
  outputs: [],
}

describe('node picker drag session', () => {
  it('provides the complete dynamic option and connection once', () => {
    const session = new NodePickerDragSession()
    const connection = vi.fn((nodeId: string) => ({ source: 'source', sourceHandle: '$out', target: nodeId, targetHandle: '$in' }))
    const token = session.register(option, connection)

    expect(session.consume(token)).toEqual({ token, option, connection })
    expect(session.consume(token)).toBeUndefined()
  })

  it('ignores unrelated drops and clears cancelled drags', () => {
    const session = new NodePickerDragSession()
    const token = session.register(option)
    expect(session.consume('other')).toBeUndefined()
    expect(session.consume(token)).toEqual({ token, option, connection: undefined })

    const cancelled = session.register(option)
    session.clear()
    expect(session.consume(cancelled)).toBeUndefined()
  })
})
