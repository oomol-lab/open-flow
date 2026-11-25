import { expect, it } from 'vitest'
import { mcpTools } from '../../control/common/mcp.ts'
import { controlRequests } from '../../control/common/requests.ts'
import { canvasCommandSchema } from './commands.ts'

it.each([{ type: 'focus', nodeId: 'node' }, { type: 'zoom', zoom: 0.1 }, { type: 'zoom', zoom: 3 }, { type: 'pan', dx: -200, dy: 100.5 }, { type: 'fit' }])(
  'shares canvas validation between REST and MCP: %j',
  (command) => {
    expect(controlRequests.canvas({ version: 1, command }).command).toEqual(command)
    expect(mcpTools.flow_canvas_control.inputSchema['~standard'].validate({ flowId: 'flow', command })).toEqual({ value: { flowId: 'flow', command } })
    expect(mcpTools.flow_canvas_control.annotations.idempotentHint).toBe(false)
  },
)

it.each([
  { type: 'focus', nodeId: '' },
  { type: 'zoom', zoom: 0.09 },
  { type: 'zoom', zoom: 3.01 },
  { type: 'zoom', zoom: '0.8' },
  { type: 'zoom', zoom: NaN },
  { type: 'pan', dx: Infinity, dy: 0 },
  { type: 'pan', dx: 0 },
  { type: 'fit', nodes: ['node'] },
  { type: 'unknown' },
])('rejects invalid canvas commands at every boundary: %j', (command) => {
  expect(canvasCommandSchema.safeParse(command).success).toBe(false)
  expect(() => controlRequests.canvas({ version: 1, command })).toThrow()
  expect(mcpTools.flow_canvas_control.inputSchema['~standard'].validate({ flowId: 'flow', command })).toHaveProperty('issues')
})
