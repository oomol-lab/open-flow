import type { AgentTool, WorkflowCapability } from '../../flow/common/change.ts'
import type { ConnectorAction } from './api.ts'

import { expect, it, vi } from 'vitest'
import { AuthoringToolInputError, outwardAgentTools, outwardCapabilities, prepareAgentTools, prepareCapabilities } from './authoringTools.ts'

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
  if (publicTool.kind == 'workflow') throw new Error('Expected connector tool')
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
  if (publicTool.kind == 'workflow') throw new Error('Expected connector tool')
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
  if (publicTool.kind == 'workflow') throw new Error('Expected connector tool')
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

it('derives workflow tool contracts and preserves sources and snapshots on ordinary edits', async () => {
  const workflow = vi.fn(async (flowId: string) => ({
    version: 1 as const,
    flowId,
    name: 'Double',
    publicationId: 'publication',
    revisionId: 'revision',
    inputs: [{ handle: 'amount', jsonSchema: { type: 'number' }, nullable: false }],
    outputs: [{ handle: 'total', jsonSchema: { type: 'number' }, nullable: false }],
  }))
  const lookup = vi.fn()
  const [created] = await prepareAgentTools(
    [{ kind: 'workflow', flowId: 'target', name: 'double', description: 'Double amount', approval: true, inputs: { amount: { kind: 'value', value: 0 } } }],
    [],
    lookup,
    () => 'workflow-tool',
    workflow,
  )
  expect(created).toMatchObject({ kind: 'workflow', flowId: 'target', revisionId: 'revision', inputs: [{ source: { kind: 'value', value: 0 } }] })
  const view = outwardAgentTools([created!])[0]!
  expect(view).not.toHaveProperty('revisionId')
  expect(view).not.toHaveProperty('outputs')
  workflow.mockClear()
  const [updated] = await prepareAgentTools([{ ...view, name: 'renamed', description: 'Updated description' }], [created!], lookup, () => 'unused', workflow)
  expect(updated).toMatchObject({ name: 'renamed', revisionId: 'revision', id: 'workflow-tool', description: 'Updated description', inputs: created!.inputs })
  expect(workflow).not.toHaveBeenCalled()
  expect(lookup).not.toHaveBeenCalled()
  await expect(prepareAgentTools([{ ...view, inputs: { unknown: { kind: 'model' } } }], [created!], lookup, () => 'unused', workflow)).rejects.toMatchObject({
    code: 'tool.input-not-found',
  })
})

const existingWorkflow: WorkflowCapability = {
  kind: 'workflow',
  name: 'double',
  flowId: 'target',
  revisionId: 'saved-revision',
  inputs: [{ handle: 'amount', jsonSchema: { type: 'number' }, nullable: false }],
  outputs: null,
}

it('renames a Code workflow capability without refreshing its saved interface', async () => {
  const workflow = vi.fn()
  const publicCapability = { kind: 'workflow' as const, name: 'renamed', flowId: existingWorkflow.flowId }
  const prepared = await prepareCapabilities([publicCapability], [existingWorkflow], workflow)
  expect(prepared).toEqual([{ ...existingWorkflow, name: 'renamed' }])
  expect(outwardCapabilities(prepared)).toEqual([publicCapability])
  expect(workflow).not.toHaveBeenCalled()
})

it.each([
  { before: ['old'], after: ['first', 'second'] },
  { before: ['first', 'second'], after: ['new'] },
])('does not infer ambiguous workflow renames from $before to $after', async ({ before, after }) => {
  const workflow = vi.fn(async (flowId: string) => ({ flowId, name: 'Unavailable', problem: 'unpublished' as const }))
  const previous = before.map((name) => ({ ...existingWorkflow, name }))
  const requested = after.map((name) => ({ kind: 'workflow' as const, name, flowId: existingWorkflow.flowId }))
  const prepared = await prepareCapabilities(requested, previous, workflow)
  expect(prepared).toEqual(requested.map((tool) => ({ ...tool, revisionId: '', inputs: [], outputs: null })))

  const tools = await prepareAgentTools(
    requested.map((tool) => Object.assign({}, tool, { description: '', approval: false })),
    previous.map((tool) => Object.assign({}, tool, { id: tool.name, description: '', approval: false, inputs: [] })),
    vi.fn(),
    () => 'new-id',
    workflow,
  )
  expect(tools.map((tool) => tool.kind == 'workflow' && { name: tool.name, revisionId: tool.revisionId, id: tool.id })).toEqual(
    after.map((name) => ({ name, revisionId: '', id: 'new-id' })),
  )
})
