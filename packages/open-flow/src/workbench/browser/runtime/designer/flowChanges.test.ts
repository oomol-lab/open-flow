import type { Draft } from '../api.ts'

import { describe, expect, it } from 'vitest'
import { setTriggerConnection } from '../../../../flow/common/nodeChanges.ts'
import { revisionView } from '../revisionView.ts'
import {
  addNode,
  applyFlowChanges,
  copyNodes,
  pasteNodes,
  setInputValue,
  setInputVariable,
  setWaitNotification,
  updateCodeTaskPorts,
  updateCondition,
  updateTaskAdditionalInputs,
  updateWait,
} from './flowChanges.ts'

function draft(source: string): Draft {
  return {
    actorId: 'actor',
    content: {
      document: {
        bindings: {},
        graph: {
          nodes: {
            task: {
              concurrency: 1,
              inputs: {},
              kind: 'task',
              name: 'Code',
              task: {
                inputs: [{ handle: 'value', jsonSchema: {}, nullable: true }],
                moduleId: 'module',
                name: 'Code',
                outputs: [{ handle: 'result', jsonSchema: {}, nullable: true }],
              },
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      modelVersion: 1,
      modules: { module: { imports: [], name: 'Code', source } },
    },
    createdAt: '2026-08-26T00:00:00.000Z',
    digest: 'digest',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'revision',
    version: 1,
  }
}

function managedDraft(): Draft {
  const base = draft('export default () => ({})\n')
  return {
    ...base,
    content: {
      ...base.content,
      document: {
        ...base.content.document,
        graph: {
          nodes: {
            task: {
              additionalInputs: [{ handle: 'start', jsonSchema: {}, nullable: false }],
              concurrency: 1,
              inputs: {
                message: { kind: 'value', value: 'Hello' },
                start: { kind: 'value', value: 'manual' },
              },
              kind: 'task',
              taskId: 'connector',
            },
          },
        },
        tasks: {
          connector: {
            executor: { action: 'send', kind: 'connector' },
            inputs: [{ handle: 'message', jsonSchema: {}, nullable: false }],
            name: 'Send',
            outputs: [],
          },
        },
      },
    },
  }
}

describe('Code task port changes', () => {
  it('does not emit a Draft change when the ports stay the same', () => {
    const current = draft('export default (input) => ({ result: input.value })\n')
    const task = current.content.document.graph.nodes.task
    if (task?.kind != 'task' || task.task == null) throw new Error('Expected code Task fixture.')

    expect(updateCodeTaskPorts(revisionView(current), { kind: 'flow' }, 'task', task.task)).toBeUndefined()
  })

  it('uses the node ID for a new code module', () => {
    const current = draft('export default () => {}\n')
    const changes = addNode(revisionView(current), { kind: 'flow' }, 'new-code', { kind: 'code', name: 'New code' }, () => 'unused')

    if (changes == null) throw new Error('Expected code task changes.')
    const changed = applyFlowChanges(current, changes)
    expect(changed.content.document.graph.nodes['new-code']).toMatchObject({ task: { moduleId: 'new-code' } })
    expect(changed.content.modules['new-code']).toMatchObject({ name: 'New code' })
  })

  it('creates a code task with connection-derived ports', () => {
    const current = draft('export default () => {}\n')
    const changes = addNode(
      revisionView(current),
      { kind: 'flow' },
      'new-code',
      {
        kind: 'code',
        name: 'New code',
        ports: {
          inputs: [{ description: 'Count', handle: 'value', jsonSchema: { type: 'number' }, nullable: false, value: null }],
          outputs: [{ handle: 'result', jsonSchema: {}, nullable: true }],
        },
      },
      () => 'unused',
    )

    if (changes == null) throw new Error('Expected code task changes.')
    expect(applyFlowChanges(current, changes).content.document.graph.nodes['new-code']).toMatchObject({
      inputs: { value: { kind: 'value', value: null } },
      task: {
        inputs: [{ description: 'Count', handle: 'value', jsonSchema: { type: 'number' }, nullable: false, value: null }],
        outputs: [{ handle: 'result', jsonSchema: {}, nullable: true }],
      },
    })
  })

  it('does not rewrite module source when ports change', () => {
    const source = [
      '//#region generated meta',
      '/**',
      ' * @typedef {{}} Inputs',
      ' * @typedef {{}} Outputs',
      ' */',
      '//#endregion',
      '',
      'export default () => {}',
      '',
    ].join('\n')
    const current = draft(source)
    const changes = updateCodeTaskPorts(revisionView(current), { kind: 'flow' }, 'task', {
      inputs: [{ group: 'Request' }, { handle: 'prompt', jsonSchema: { type: 'string' }, nullable: false }],
      outputs: [
        { group: 'Result', collapsed: true },
        { handle: 'count', jsonSchema: { type: 'number' }, nullable: false },
      ],
    })

    if (changes == null) throw new Error('Expected code task port changes.')
    const changed = applyFlowChanges(current, changes)
    expect(changed.content.modules.module?.source).toBe(source)
    expect(changed.content.document.graph.nodes.task).toMatchObject({
      task: {
        inputs: [{ group: 'Request' }, { handle: 'prompt' }],
        outputs: [{ collapsed: true, group: 'Result' }, { handle: 'count' }],
      },
    })
  })

  it('does not recreate a removed generated metadata region', () => {
    const current = draft('export default (input) => ({ result: input.value })\n')
    const changes = updateCodeTaskPorts(revisionView(current), { kind: 'flow' }, 'task', {
      inputs: [{ handle: 'prompt', jsonSchema: { type: 'string' }, nullable: false }],
      outputs: [{ handle: 'count', jsonSchema: { type: 'number' }, nullable: false }],
    })

    if (changes == null) throw new Error('Expected code task port changes.')
    expect(applyFlowChanges(current, changes).content.modules.module?.source).toBe(current.content.modules.module?.source)
  })
})

describe('Managed task additional input changes', () => {
  it('renames and removes only node-local input mappings', () => {
    const current = managedDraft()

    const renamed = updateTaskAdditionalInputs(revisionView(current), { kind: 'flow' }, 'task', [{ handle: 'trigger', jsonSchema: {}, nullable: false }])
    if (renamed == null) throw new Error('Expected additional input changes.')
    const changed = applyFlowChanges(current, renamed)
    expect(changed.content.document.graph.nodes.task).toMatchObject({
      additionalInputs: [{ handle: 'trigger' }],
      inputs: { message: { value: 'Hello' }, trigger: { value: 'manual' } },
    })

    const removed = updateTaskAdditionalInputs(revisionView(changed), { kind: 'flow' }, 'task', [])
    if (removed == null) throw new Error('Expected additional input removal.')
    expect(applyFlowChanges(changed, removed).content.document.graph.nodes.task).toEqual({
      concurrency: 1,
      inputs: { message: { kind: 'value', value: 'Hello' } },
      kind: 'task',
      taskId: 'connector',
    })
  })
})

describe('Condition changes', () => {
  it('does not emit a change when an optional default output remains absent', () => {
    const current = applyFlowChanges(draft('export default () => ({})\n'), [
      {
        kind: 'graph.node.create',
        node: {
          cases: [{ expressions: [{ input: 'value', operator: 'isTrue' }], output: 'true', relation: 'all' }],
          concurrency: 1,
          input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
          inputs: { value: { kind: 'value', value: null } },
          kind: 'condition',
        },
        nodeId: 'condition',
        target: { kind: 'flow' },
      },
    ])
    const condition = current.content.document.graph.nodes.condition
    if (condition?.kind != 'condition') throw new Error('Expected Condition fixture.')

    expect(
      updateCondition(revisionView(current), { kind: 'flow' }, 'condition', {
        cases: condition.cases,
        input: condition.input,
      }),
    ).toEqual([])
  })
})

describe('Wait changes', () => {
  it('creates Wait only in the root graph and removes edges for actions that no longer exist', () => {
    const current = draft('export default (input) => ({ result: input.value })\n')
    const created = addNode(revisionView(current), { kind: 'flow' }, 'wait', { kind: 'wait', name: 'Wait' }, () => 'unused')
    if (created == null) throw new Error('Expected Wait changes.')
    let changed = applyFlowChanges(current, created)
    const task = changed.content.document.graph.nodes.task
    if (task?.kind != 'task') throw new Error('Expected Task fixture.')
    changed = applyFlowChanges(changed, [
      {
        before: task.inputs.value,
        handle: 'value',
        kind: 'graph.node.input.set',
        nodeId: 'task',
        target: { kind: 'flow' },
        value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'wait', output: 'continue' }] },
      },
      {
        kind: 'graph.node.create',
        node: {
          actions: ['continue'],
          concurrency: 1,
          input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
          inputs: { value: { kind: 'value', value: null } },
          kind: 'wait',
          notification: {
            inputs: {
              message: {
                kind: 'sources',
                sources: [
                  { kind: 'node', nodeId: 'wait', output: 'continue' },
                  { kind: 'node', nodeId: 'task', output: 'result' },
                ],
              },
              title: { kind: 'value', value: 'Review' },
            },
            messageHandle: 'message',
            taskId: 'notify',
          },
          prompt: 'Review?',
        },
        nodeId: 'review',
        target: { kind: 'flow' },
      },
    ])

    const updated = updateWait(revisionView(changed), { kind: 'flow' }, 'wait', {
      actions: ['approve', 'reject'],
      name: 'Approval',
      notification: undefined,
      prompt: 'Approve this request?',
    })
    if (updated == null) throw new Error('Expected updated Wait changes.')
    changed = applyFlowChanges(changed, updated)

    expect(changed.content.document.graph.nodes.wait).toMatchObject({ actions: ['approve', 'reject'], name: 'Approval', prompt: 'Approve this request?' })
    expect(changed.content.document.graph.nodes.task).toMatchObject({ inputs: {} })
    expect(changed.content.document.graph.nodes.review).toMatchObject({
      notification: {
        inputs: {
          message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'result' }] },
          title: { kind: 'value', value: 'Review' },
        },
      },
    })
    expect(addNode(revisionView(changed), { id: 'child', kind: 'subflow' }, 'nested-wait', { kind: 'wait', name: 'Wait' }, () => 'unused')).toBeUndefined()
  })

  it('creates a Connector notification without adding a graph node', () => {
    const current = applyFlowChanges(draft('export default () => ({ result: null })\n'), [
      {
        kind: 'graph.node.create',
        node: {
          actions: ['continue'],
          concurrency: 1,
          input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
          inputs: { value: { kind: 'value', value: null } },
          kind: 'wait',
          prompt: 'Continue?',
        },
        nodeId: 'wait',
        target: { kind: 'flow' },
      },
    ])

    const updated = setWaitNotification(
      revisionView(current),
      'wait',
      {
        actionId: 'message.send',
        authenticated: true,
        defaultConnection: { connectionId: 'connection-1', displayName: 'Bot', isDefault: true, serviceId: 'message', status: 'active' },
        description: 'Send message.',
        inputs: { text: { jsonSchema: { type: 'string' }, nullable: false } },
        name: 'Send message',
        outputs: {},
        serviceId: 'message',
        serviceName: 'Message',
      },
      'notify',
    )
    if (updated == null) throw new Error('Expected notification changes.')
    const changed = applyFlowChanges(current, updated)

    expect(Object.keys(changed.content.document.graph.nodes)).toEqual(['task', 'wait'])
    expect(changed.content.document.graph.nodes.wait).toMatchObject({
      notification: { inputs: {}, messageHandle: 'text', taskId: 'notify' },
    })
    expect(changed.content.document.tasks.notify).toMatchObject({
      executor: { action: 'message.send', connectionId: 'connection-1', kind: 'connector' },
    })

    expect(
      updateWait(revisionView(changed), { kind: 'flow' }, 'wait', {
        actions: ['continue'],
        notification: changed.content.document.graph.nodes.wait?.kind == 'wait' ? changed.content.document.graph.nodes.wait.notification : undefined,
        prompt: 'Continue?',
      }),
    ).toEqual([])

    const removed = updateWait(revisionView(changed), { kind: 'flow' }, 'wait', {
      actions: ['continue'],
      notification: undefined,
      prompt: 'Continue?',
    })
    if (removed == null) throw new Error('Expected notification removal changes.')
    expect(applyFlowChanges(changed, removed).content.document.tasks.notify).toBeUndefined()
  })

  it('remaps notification bindings when a Wait is copied', () => {
    const current = applyFlowChanges(draft('export default () => ({ result: null })\n'), [
      { binding: { kind: 'variable', target: 'RECIPIENT' }, bindingId: 'recipient', kind: 'binding.create' },
      {
        kind: 'task.create',
        task: {
          executor: { action: 'mail.send', connectionId: 'connection-1', kind: 'connector' },
          inputs: [
            { handle: 'recipient', jsonSchema: { type: 'string' }, nullable: false },
            { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
          ],
          name: 'Notify',
          outputs: [],
        },
        taskId: 'notify',
      },
      {
        kind: 'graph.node.create',
        node: {
          actions: ['continue'],
          concurrency: 1,
          input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
          inputs: { value: { kind: 'value', value: null } },
          kind: 'wait',
          notification: {
            inputs: { recipient: { kind: 'sources', sources: [{ bindingId: 'recipient', kind: 'binding' }] } },
            messageHandle: 'message',
            taskId: 'notify',
          },
          prompt: 'Continue?',
        },
        nodeId: 'wait',
        target: { kind: 'flow' },
      },
    ])
    const clipboard = copyNodes(revisionView(current), { kind: 'flow' }, ['wait'])
    const ids = ['wait-copy', 'recipient-copy']
    const pasted = pasteNodes(revisionView(current), { kind: 'flow' }, clipboard, () => {
      const id = ids.shift()
      if (id == null) throw new Error('Expected a clipboard identity.')
      return id
    })
    const changed = applyFlowChanges(current, pasted.changes)

    expect(changed.content.document.bindings['recipient-copy']).toEqual({ kind: 'variable', target: 'RECIPIENT' })
    expect(changed.content.document.graph.nodes['wait-copy']).toMatchObject({
      notification: {
        inputs: { recipient: { sources: [{ bindingId: 'recipient-copy', kind: 'binding' }] } },
        taskId: 'notify',
      },
    })
  })
})

describe('Variable input changes', () => {
  it('does not emit a Draft change when clearing an unbound Variable input', () => {
    const current = draft('export default ({ value }) => ({ result: value })\n')

    expect(setInputValue(revisionView(current), { kind: 'flow' }, 'task', 'value', undefined)).toBeUndefined()
  })

  it('creates, replaces, copies on shared edit, and cleans Variable bindings', () => {
    const current = draft('export default ({ value }) => ({ result: value })\n')
    const created = setInputVariable(revisionView(current), { kind: 'flow' }, 'task', 'value', 'TOKEN', 'binding-a')
    if (created == null) throw new Error('Expected Variable input changes.')
    const bound = applyFlowChanges(current, created)
    expect(bound.content.document.bindings).toEqual({ 'binding-a': { kind: 'variable', target: 'TOKEN' } })
    expect(bound.content.document.graph.nodes.task).toMatchObject({
      inputs: { value: { kind: 'sources', sources: [{ bindingId: 'binding-a', kind: 'binding' }] } },
    })

    const replaced = setInputVariable(revisionView(bound), { kind: 'flow' }, 'task', 'value', 'OTHER', 'unused')
    if (replaced == null) throw new Error('Expected Variable replacement.')
    const updated = applyFlowChanges(bound, replaced)
    expect(updated.content.document.bindings).toEqual({ 'binding-a': { kind: 'variable', target: 'OTHER' } })

    const task = updated.content.document.graph.nodes.task
    if (task?.kind != 'task') throw new Error('Expected Task fixture.')
    const shared = applyFlowChanges(updated, [{ kind: 'graph.node.create', node: { ...task, name: 'Second' }, nodeId: 'second', target: { kind: 'flow' } }])
    const detached = setInputVariable(revisionView(shared), { kind: 'flow' }, 'task', 'value', 'THIRD', 'binding-b')
    if (detached == null) throw new Error('Expected copy-on-write Variable changes.')
    const changed = applyFlowChanges(shared, detached)
    expect(changed.content.document.bindings).toEqual({
      'binding-a': { kind: 'variable', target: 'OTHER' },
      'binding-b': { kind: 'variable', target: 'THIRD' },
    })
    expect(changed.content.document.graph.nodes.second).toMatchObject({
      inputs: { value: { sources: [{ bindingId: 'binding-a' }] } },
    })

    const cleared = setInputValue(revisionView(changed), { kind: 'flow' }, 'task', 'value', undefined)
    if (cleared == null) throw new Error('Expected cleared Variable input.')
    expect(applyFlowChanges(changed, cleared).content.document.bindings).toEqual({ 'binding-a': { kind: 'variable', target: 'OTHER' } })
  })

  it('copies Variable declarations with fresh binding IDs', () => {
    const current = draft('export default ({ value }) => ({ result: value })\n')
    const changes = setInputVariable(revisionView(current), { kind: 'flow' }, 'task', 'value', 'TOKEN', 'binding-a')
    if (changes == null) throw new Error('Expected Variable input changes.')
    const bound = applyFlowChanges(current, changes)
    const clipboard = copyNodes(revisionView(bound), { kind: 'flow' }, ['task'])
    const ids = ['task-copy', 'binding-copy']
    const pasted = pasteNodes(revisionView(bound), { kind: 'flow' }, clipboard, () => {
      const id = ids.shift()
      if (id == null) throw new Error('Paste requested an unexpected identity.')
      return id
    })
    const changed = applyFlowChanges(bound, pasted.changes)

    expect(clipboard.bindings).toEqual({ 'binding-a': { kind: 'variable', target: 'TOKEN' } })
    expect(changed.content.document.bindings).toEqual({
      'binding-a': { kind: 'variable', target: 'TOKEN' },
      'binding-copy': { kind: 'variable', target: 'TOKEN' },
    })
    expect(changed.content.document.graph.nodes['task-copy']).toMatchObject({
      inputs: { value: { sources: [{ bindingId: 'binding-copy', kind: 'binding' }] } },
    })
  })
})

describe('Provider Trigger changes', () => {
  it('creates an unconnected Trigger and adds its binding when a Connection is selected', () => {
    const current = draft('export default () => {}\n')
    const ids = ['binding']
    const changes = addNode(
      revisionView(current),
      { kind: 'flow' },
      'trigger',
      {
        definition: {
          configSchema: { additionalProperties: false, type: 'object' },
          definitionVersion: 1,
          description: 'Runs when a repository changes.',
          displayName: 'Repository event',
          endpoint: {
            body: { allowArray: false, allowEmpty: false, formats: ['json'] },
            methods: ['POST'],
            successStatus: 200,
          },
          key: 'github.on_repo_event',
          name: 'on_repo_event',
          payloadSchema: { additionalProperties: true, type: 'object' },
          provider: 'github',
          type: 'integration',
        },
        kind: 'provider-trigger',
      },
      () => {
        const id = ids.shift()
        if (id == null) throw new Error('Expected a Trigger identity.')
        return id
      },
    )

    if (changes == null) throw new Error('Expected provider Trigger changes.')
    const added = applyFlowChanges(current, changes)
    expect(added.content.document.bindings).toEqual({})
    expect(added.content.document.graph.nodes.trigger).toMatchObject({ bindingId: 'binding', kind: 'integration' })

    const connected = setTriggerConnection(added.content, { kind: 'flow' }, 'trigger', 'github-work')
    if (connected == null) throw new Error('Expected Trigger Connection changes.')
    expect(applyFlowChanges(added, connected).content.document.bindings).toEqual({
      binding: { kind: 'connection', target: 'github-work' },
    })
  })
})
