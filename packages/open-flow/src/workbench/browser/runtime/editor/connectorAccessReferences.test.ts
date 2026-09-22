import type { FlowDocument } from '../../../../flow/common/change.ts'
import type { Draft } from '../api.ts'

import { expect, it } from 'vitest'
import { RevisionView } from '../revisionView.ts'

function connectorAccessReferences(document: FlowDocument) {
  return new RevisionView({ content: { document, modules: {} } } as Draft).connectorReferences
}

function flowDocument(): FlowDocument {
  return {
    bindings: { events: { kind: 'connection', target: 'work' } },
    tasks: {
      send: { name: 'Send mail', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'work' } },
      pending: { name: 'Pending', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send' } },
      unused: { name: 'Unused', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'other' } },
    },
    graph: {
      edges: [],
      nodes: {
        first: { kind: 'task', inputs: {}, taskId: 'send', name: 'Send receipt' },
        second: { kind: 'task', inputs: {}, taskId: 'send' },
        pending: { kind: 'task', inputs: {}, taskId: 'pending' },
        code: {
          kind: 'task',
          inputs: {},
          task: { moduleId: 'code', name: 'Code', inputs: [], outputs: [], capabilities: [{ kind: 'connector', actionHints: ['mail.send'] }] },
        },
        event: {
          kind: 'poll',
          bindingId: 'events',
          name: 'New mail',
          config: {},
          pollTimes: [],
          definition: {
            type: 'poll',
            provider: 'mail',
            name: 'received',
            key: 'mail.received',
            displayName: 'New mail',
            description: '',
            definitionVersion: 2,
            configInputs: [],
            outputs: [],
          },
        },
      },
    },
    subflows: { child: { name: 'Follow-up', inputs: [], outputs: [], graph: { edges: [], nodes: { first: { kind: 'task', inputs: {}, taskId: 'send' } } } } },
  }
}

it('matches explicit account IDs across nodes, triggers and subflows without inferring dynamic code or unused tasks', () => {
  const result = connectorAccessReferences(flowDocument())
  expect(result.hasCode).toBe(true)
  expect(result.accounts.filter((item) => item.connectionId == 'work').map((item) => item.name)).toEqual([
    'Send receipt',
    'Send mail',
    'New mail',
    'Follow-up / Send mail',
  ])
  expect(result.accounts.filter((item) => item.connectionId == null).map((item) => item.nodeId)).toEqual(['pending'])
  expect(result.accounts.at(-1)?.target).toEqual({ kind: 'subflow', id: 'child' })
  expect(result.accounts.some((item) => item.nodeId == 'code' || item.connectionId == 'other')).toBe(false)
})

it('deduplicates agent tool and notification references to the same account', () => {
  const source = flowDocument()
  const result = connectorAccessReferences({
    ...source,
    graph: { edges: [], nodes: { agent: { kind: 'task', inputs: {}, taskId: 'agent' } } },
    subflows: {},
    tasks: {
      ...source.tasks,
      agent: {
        name: 'Assistant',
        inputs: [],
        outputs: [],
        executor: {
          kind: 'agent',
          model: 'model',
          prompt: { kind: 'value', value: '' },
          system: '',
          maxRounds: 1,
          tools: [{ id: 'send', action: 'mail.send', name: 'Send', connectionId: 'work', inputs: [], approval: false, description: '' }],
          notification: { taskId: 'send', messageHandle: 'message', inputs: {} },
        },
      },
    },
  })
  expect(result.hasCode).toBe(false)
  expect(result.accounts).toEqual([{ providerId: 'mail', connectionId: 'work', nodeId: 'agent', name: 'Assistant', target: { kind: 'flow' } }])
})
