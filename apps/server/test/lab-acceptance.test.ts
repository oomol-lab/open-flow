import type { RunEvent } from '@oomol-lab/open-flow/control-api'
import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { expect, it } from 'vitest'
import { runtimeAssertions } from '../scripts/lab/acceptance.ts'

const task = (name: string) => ({ kind: 'task' as const, name, inputs: {}, task: { name, moduleId: 'code', inputs: [], outputs: [], capabilities: [] } })
const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: {
    bindings: {},
    graph: {
      edges: [],
      nodes: {
        configured: task('Retried task updated'),
        cleared: task('Cleared task'),
      },
    },
  },
}
function completed(nodeId: string, value = 42): RunEvent {
  return {
    kind: 'node.completed',
    createdAt: '2026-10-20T00:00:00Z',
    sequence: 1,
    payload: { flowId: 'flow', scopeId: 'scope', executionId: nodeId, nodeId, outputs: { value } },
  }
}
function verify(events: readonly RunEvent[], calls: Parameters<typeof runtimeAssertions>[3] = [], modelCalls: unknown[] = []) {
  return runtimeAssertions('node-retries', { name: 'sample', orders: [], order: {} }, 'completed', calls, modelCalls, events, content)
}
it('requires one expected output from each configured Code task', () => {
  expect(verify([completed('configured'), completed('cleared')])).toEqual([])
  expect(verify([completed('unrelated-a'), completed('unrelated-b')])).not.toEqual([])
  expect(verify([completed('configured'), completed('unrelated')])).not.toEqual([])
  expect(verify([completed('configured'), completed('configured'), completed('cleared')])).not.toEqual([])
  expect(verify([completed('configured'), completed('cleared', 0)])).not.toEqual([])
})
it('rejects external calls even when both tasks complete correctly', () => {
  const events = [completed('configured'), completed('cleared')]
  expect(verify(events, [{ action: 'unexpected', connection: 'account', input: {}, invocationId: 'unexpected' }])).not.toEqual([])
  expect(verify(events, [], [{}])).not.toEqual([])
})
