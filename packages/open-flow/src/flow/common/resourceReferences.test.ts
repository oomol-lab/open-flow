import type { RevisionContent } from './change.ts'

import { expect, it } from 'vitest'
import { flowResourceReferences } from './semantics.ts'

it('collects referenced variables, selected accounts across executors, and error sources with deterministic deduplication', () => {
  const content: RevisionContent = {
    modelVersion: 6,
    modules: {},
    document: {
      bindings: {
        first: { kind: 'variable', target: 'TOKEN' },
        second: { kind: 'variable', target: 'TOKEN' },
        unused: { kind: 'variable', target: 'UNUSED' },
      },
      graph: {
        edges: [],
        nodes: {
          action: {
            kind: 'task',
            inputs: { token: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'first' }] } },
            task: { name: 'Action', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'account' } },
          },
          agent: {
            kind: 'task',
            inputs: { token: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'second' }] } },
            task: {
              name: 'Agent',
              inputs: [],
              outputs: [],
              executor: {
                kind: 'agent',
                model: 'model',
                prompt: '',
                maxRounds: 1,
                tools: [{ id: 'send', name: 'Send', description: '', action: 'mail.send', connectionId: 'account', approval: false, inputs: [] }],
                notification: { action: 'chat.send', connectionId: 'notice', inputs: {}, inputDefinitions: [], messageHandle: 'message' },
              },
            },
          },
          code: {
            kind: 'task',
            inputs: {},
            task: {
              name: 'Code',
              inputs: [],
              outputs: [],
              moduleId: 'code',
              capabilities: [
                { kind: 'connector', mode: 'shared' },
                { kind: 'connector', mode: 'independent', actions: [{ action: 'mail.read', connectionId: 'code-account' }] },
              ],
            },
          },
          trigger: {
            kind: 'integration',
            name: 'Trigger',
            config: {},
            connectionId: 'account',
            definition: {
              type: 'integration',
              key: 'mail.new',
              provider: 'mail',
              configInputs: [],
              definitionVersion: 1,
              description: '',
              displayName: 'New mail',
              name: 'new',
              outputs: [],
              endpoint: { body: { allowArray: false, allowEmpty: true, formats: ['json'] }, methods: ['POST'], successStatus: 200 },
            },
          },
          unselected: {
            kind: 'task',
            inputs: {},
            task: { name: 'Unselected', inputs: [], outputs: [], executor: { kind: 'connector', action: 'drive.read' } },
          },
          error: { kind: 'error', name: 'Error', sourceFlowIds: ['z', 'a', 'z'] },
        },
      },
    },
  }
  expect(flowResourceReferences(content)).toEqual({
    variableNames: ['TOKEN'],
    connections: [
      { providerId: 'chat', connectionId: 'notice' },
      { providerId: 'mail', connectionId: 'account' },
      { providerId: 'mail', connectionId: 'code-account' },
    ],
    errorSourceFlowIds: ['a', 'z'],
  })
})
