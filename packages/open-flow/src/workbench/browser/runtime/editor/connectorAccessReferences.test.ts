import type { TaskNode } from '../../../../flow/common/change.ts'
import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'
import type { FlowDocument, GraphNode, RevisionContent } from '../../../../flow/common/change.ts'
import type { Draft } from '../api.ts'

import { expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { removeConnectionUsage } from '../../../../flow/common/connectionUsage.ts'
import { RevisionView } from '../revisionView.ts'

function connectorAccessReferences(document: FlowDocument) {
  return new RevisionView({ content: { document, modules: {} } } as Draft).connectorReferences
}

function flowDocument(): FlowDocument {
  return {
    bindings: {},

    graph: {
      edges: [],
      nodes: {
        first: {
          kind: 'task',
          inputs: {},
          task: { name: 'Send mail', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'work' } },
          name: 'Send receipt',
        },
        second: {
          kind: 'task',
          inputs: {},
          task: { name: 'Send mail', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'work' } },
        },
        pending: { kind: 'task', inputs: {}, task: { name: 'Pending', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send' } } },
        code: {
          kind: 'task',
          inputs: {},
          task: { moduleId: 'code', name: 'Code', inputs: [], outputs: [], capabilities: [{ kind: 'connector', actionHints: ['mail.send'] }] },
        },
        event: {
          kind: 'poll',
          connectionId: 'work',
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
  }
}

it('matches explicit account IDs across nodes and triggers without inferring dynamic code permissions', () => {
  const result = connectorAccessReferences(flowDocument())
  expect(result.hasCode).toBe(true)
  expect(result.accounts.filter((item) => item.connectionId == 'work').map((item) => item.name)).toEqual(['Send receipt', 'Send mail', 'New mail'])
  expect(result.accounts.filter((item) => item.connectionId == null).map((item) => item.nodeId)).toEqual(['pending'])
  expect(result.accounts.at(-1)?.target).toEqual({ kind: 'flow' })
  expect(result.accounts.some((item) => item.nodeId == 'code' || item.connectionId == 'other')).toBe(false)
})

it('distinguishes agent tools and notifications using the same account', () => {
  const source = flowDocument()
  const document: FlowDocument = {
    ...source,
    graph: {
      edges: [],
      nodes: {
        agent: {
          kind: 'task',
          inputs: {},
          task: {
            name: 'Assistant',
            inputs: [],
            outputs: [],
            executor: {
              kind: 'agent',
              model: 'model',
              prompt: '',
              maxRounds: 1,
              tools: [{ id: 'send', action: 'mail.send', name: 'Send', connectionId: 'work', inputs: [], approval: false, description: '' }],
              notification: { action: 'mail.send', connectionId: 'work', inputDefinitions: [], messageHandle: 'message', inputs: {} },
            },
          },
        },
      },
    },
  }
  const result = connectorAccessReferences(document)
  const removed = removeConnectionUsage({ modelVersion: currentFlowModelVersion, document, modules: {} }, 'work')
  expect(connectorAccessReferences(removed.document).accounts.every((use) => use.connectionId == null)).toBe(true)
  expect(((removed.document.graph.nodes['agent'] as TaskNode).task as ManagedTaskDefinition)?.executor).toMatchObject({
    tools: [{ id: 'send', action: 'mail.send' }],
  })
  expect(result.hasCode).toBe(false)
  expect(result.accounts.map(({ kind, connectionId, nodeId }) => ({ kind, connectionId, nodeId }))).toEqual([
    { kind: 'agent', connectionId: 'work', nodeId: 'agent' },
    { kind: 'notification', connectionId: 'work', nodeId: 'agent' },
  ])
})

it('removes account usage across nodes and triggers while preserving graph, code and other accounts', () => {
  const document = flowDocument()
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    document,
    modules: { code: { name: 'Code', source: 'export default () => ({})', imports: [] } },
  }
  const changed = removeConnectionUsage(content, 'work')
  const { connectionId: _, ...event } = document.graph.nodes.event as Extract<GraphNode, { kind: 'poll' }>
  expect(changed.document.graph.edges).toEqual(document.graph.edges)
  expect(changed.document.graph.nodes.event).toEqual(event)
  expect(changed.document.graph.nodes.code).toEqual(document.graph.nodes.code)
  expect(changed.document.graph.nodes.pending).toEqual(document.graph.nodes.pending)
  for (const id of ['first', 'second']) {
    expect(changed.document.graph.nodes[id]).toMatchObject({ task: { executor: { kind: 'connector', action: 'mail.send' } } })
    expect((changed.document.graph.nodes[id] as TaskNode).task).not.toHaveProperty('executor.connectionId')
  }
  expect(changed.modules).toEqual(content.modules)
  expect(changed.document.bindings).toEqual({})
  expect(connectorAccessReferences(changed.document).accounts.every((use) => use.connectionId == null)).toBe(true)
  expect(removeConnectionUsage(changed, 'work')).toEqual(changed)
  expect(document.graph.nodes.first).toHaveProperty('task.executor.connectionId', 'work')
})
