import type { Draft } from '../api.ts'

import { describe, expect, it } from 'vitest'
import { setTriggerConnection } from '../../../../flow/common/nodeChanges.ts'
import { revisionView } from '../revisionView.ts'
import { addNode, applyFlowChanges, copyNodes, pasteNodes, setInputValue, setInputVariable, updateCodeTaskPorts } from './flowChanges.ts'

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
      () => ids.shift()!,
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
