import type { AgentTool } from '../../flow/common/change.ts'
import type { ConnectorAction } from './api.ts'

import { expect, it, vi } from 'vitest'
import { AuthoringToolInputError, outwardAgentTools, prepareAgentTools } from './authoringTools.ts'

const existing: AgentTool = {
  id: 'existing-tool',
  name: 'notify',
  description: 'Notify operations',
  action: 'notifications.send',
  connectionId: 'test-account',
  approval: true,
  inputs: [
    { handle: 'text', description: 'Message', jsonSchema: { type: 'string', minLength: 1 }, nullable: false, source: { kind: 'model' } },
    { handle: 'channel', jsonSchema: { type: 'string' }, nullable: false, value: 'ops', source: { kind: 'value', value: 'orders' } },
  ],
}
const action: ConnectorAction = {
  actionId: 'notifications.send',
  authenticated: true,
  description: '',
  name: 'Send notification',
  serviceId: 'notifications',
  serviceName: 'Notifications',
  inputs: {
    text: { description: 'Message', jsonSchema: { type: 'string' }, nullable: false },
    channel: { jsonSchema: { type: 'string' }, nullable: true, value: 'ops' },
  },
  outputs: {},
}

it('exposes only named sources and assembles new tools from authoritative Action inputs', async () => {
  const publicTool = outwardAgentTools([existing])[0]!
  expect(publicTool.inputs).toEqual({ text: { kind: 'model' }, channel: { kind: 'value', value: 'orders' } })
  expect(JSON.stringify(publicTool)).not.toMatch(/jsonSchema|nullable|existing-tool/)
  const lookup = vi.fn(async () => action)
  const tools = await prepareAgentTools([{ ...publicTool, inputs: { text: { kind: 'input', input: 'summary' } } }], [], lookup, () => 'new-tool')
  expect(lookup).toHaveBeenCalledWith('notifications.send')
  expect(tools[0]).toMatchObject({
    id: 'new-tool',
    inputs: [
      { handle: 'text', jsonSchema: { type: 'string' }, nullable: false, source: { kind: 'input', input: 'summary' } },
      { handle: 'channel', nullable: true, value: 'ops', source: { kind: 'model' } },
    ],
  })
})

it('preserves existing constraints, default values, order and sources without catalog reads', async () => {
  const lookup = vi.fn(async () => action)
  const publicTool = outwardAgentTools([existing])[0]!
  const changed = await prepareAgentTools([{ ...publicTool, description: 'New description', approval: false }], [existing], lookup, () => 'unused')
  expect(changed[0]).toEqual({ ...existing, description: 'New description', approval: false })
  const rebound = await prepareAgentTools([{ ...publicTool, inputs: { text: { kind: 'input', input: 'summary' } } }], [existing], lookup, () => 'unused')
  expect(rebound[0]!.inputs).toEqual([{ ...existing.inputs[0], source: { kind: 'input', input: 'summary' } }, existing.inputs[1]])
  const { inputs: _inputs, ...withoutInputs } = publicTool
  const unchanged = await prepareAgentTools([withoutInputs], [existing], lookup, () => 'unused')
  expect(unchanged[0]).toEqual(existing)
  expect(lookup).not.toHaveBeenCalled()
})

it('refreshes input contracts when selecting another Action and rejects unknown binding names', async () => {
  const publicTool = outwardAgentTools([existing])[0]!
  const lookup = vi.fn(async () => ({ ...action, actionId: 'other.send', inputs: { payload: { jsonSchema: {}, nullable: false } } }))
  const changed = await prepareAgentTools([{ ...publicTool, action: 'other.send', inputs: {} }], [existing], lookup, () => 'unused')
  expect(changed[0]).toMatchObject({ id: existing.id, action: 'other.send', inputs: [{ handle: 'payload', source: { kind: 'model' } }] })
  await expect(prepareAgentTools([{ ...publicTool, inputs: { typo: { kind: 'model' } } }], [existing], lookup, () => 'unused')).rejects.toMatchObject({
    code: 'tool.input-not-found',
    details: { tool: 'notify', action: existing.action, input: 'typo', choices: ['text', 'channel'] },
  })
  await expect(prepareAgentTools([{ ...publicTool, inputs: { text: { kind: 'model' } } }], [], lookup, () => 'unused')).rejects.toBeInstanceOf(
    AuthoringToolInputError,
  )
})
