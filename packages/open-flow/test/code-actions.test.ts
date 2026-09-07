import type { ConnectorCapability, RevisionContent } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/engineContract.ts'
import { createActions, resolveAction } from '../src/execution/common/runtime.ts'
import { applyFlowChanges, decodeConnectorCapabilities } from '../src/flow/common/change.ts'
import { digestBytes, encodeRevision } from '../src/flow/common/encoding.ts'
import { createCodeTask, setCodeActions } from '../src/flow/common/nodeChanges.ts'
import { codeActions, flowClosure, prepareFlow } from '../src/flow/common/semantics.ts'

const target = { kind: 'flow' } as const
const action: ConnectorCapability = {
  kind: 'connector',
  action: 'github.get_current_user',
  connections: [{ connectionId: 'work', alias: 'office' }, { connectionId: 'home' }],
}
function revision(): RevisionContent {
  return applyFlowChanges(
    { document: { bindings: {}, graph: { edges: [], nodes: {} }, subflows: {}, tasks: {} }, modules: {}, modelVersion: 1 },
    createCodeTask(target, { nodeId: 'code', moduleId: 'code' }, 'Code'),
  )
}

describe('Code Action declarations', () => {
  it('supports fixed aliases, multiple connections, optional defaults and public actions', () => {
    const declarations = [action, { kind: 'connector', action: 'public.echo', connections: [] }]
    expect(decodeConnectorCapabilities(declarations)).toEqual(declarations)
    expect(decodeConnectorCapabilities([{ ...action, connectionId: 'work' }])).toEqual([{ ...action, connectionId: 'work' }])
  })

  it.each([
    null,
    [{ ...action, extra: true }],
    [{ ...action, action: 'github' }],
    [action, action],
    [{ ...action, connectionId: 'other' }],
    [{ ...action, connections: [{ connectionId: 'work' }, { connectionId: 'work' }] }],
    [
      {
        ...action,
        connections: [
          { connectionId: 'work', alias: 'same' },
          { connectionId: 'home', alias: 'same' },
        ],
      },
    ],
    [{ ...action, connections: [{ connectionId: 'work', alias: '' }] }],
    [{ ...action, connections: [{ connectionId: 'work', token: 'secret' }] }],
    [{ ...action, connections: null }],
  ])('rejects invalid declarations %j', (value) => {
    expect(() => decodeConnectorCapabilities(value)).toThrow()
  })

  it('saves declarations without losing source and rejects stale edits', () => {
    const source = revision()
    const operations = setCodeActions(source, target, 'code', [action])
    if (operations == null) throw new Error('Expected Action edit.')
    const saved = applyFlowChanges(source, operations)
    expect(saved.modules).toEqual(source.modules)
    expect(saved.document.graph.nodes.code).toMatchObject({ task: { capabilities: [action] } })
    expect(setCodeActions(saved, target, 'code', [action])).toBeUndefined()
    expect(() => applyFlowChanges(saved, operations)).toThrow(/changed/)
    expect(() =>
      applyFlowChanges(source, [{ kind: 'graph.node.task.capabilities.set', target, nodeId: 'code', value: [{ ...action, connectionId: 'missing' }] }]),
    ).toThrow()
  })

  it('preserves declarations in canonical serialization and includes aliases and defaults in the digest', async () => {
    const source = revision()
    const variants = [
      action,
      { ...action, connectionId: 'work' },
      { ...action, connections: [{ connectionId: 'work', alias: 'changed' }, { connectionId: 'home' }] },
    ]
    const contents = variants.map((value) => {
      const changes = setCodeActions(source, target, 'code', [value])
      if (changes == null) throw new Error('Expected Action edit.')
      return applyFlowChanges(source, changes)
    })
    const digests = await Promise.all(contents.map((content) => digestBytes(encodeRevision(content))))
    expect(new Set(digests).size).toBe(3)
    const closures = await Promise.all(contents.map(flowClosure))
    expect(new Set(closures.map((closure) => closure.digest)).size).toBe(3)
    for (const content of contents) {
      const decoded = JSON.parse(new TextDecoder().decode(encodeRevision(content))) as RevisionContent
      expect(decoded).toEqual({ ...content, kind: 'open-flow-flow-revision', version: 1 })
    }
  })

  it('collects declarations from referenced Subflows and excludes unused definitions', async () => {
    const source = revision()
    const subflow = { name: 'Child', inputs: [], outputs: [], graph: { ...source.document.graph, nodes: { ...source.document.graph.nodes } } }
    const child = source.document.graph.nodes.code
    if (child?.kind != 'task' || child.task == null) throw new Error('Expected Code node.')
    subflow.graph.nodes.code = { ...child, task: { ...child.task, capabilities: [action] } }
    const prepared = await prepareFlow(
      {
        ...source,
        document: {
          ...source.document,
          graph: { edges: [], nodes: { child: { kind: 'subflow', subflowId: 'child', inputs: {} } } },
          subflows: {
            child: subflow,
            unused: {
              ...subflow,
              graph: {
                edges: [],
                nodes: { code: { ...child, task: { ...child.task, capabilities: [{ kind: 'connector', action: 'unused.action', connections: [] }] } } },
              },
            },
          },
        },
      },
      currentEngineContract,
    )
    expect(prepared.kind).toBe('prepared')
    if (prepared.kind != 'prepared') throw new Error('Expected prepared Subflow.')
    expect(codeActions(prepared.flow)).toEqual([action])
  })
})

describe('Code Action calls', () => {
  it('keeps special property names as ordinary frozen methods', async () => {
    const actions = createActions([{ kind: 'connector', action: '__proto__.constructor', connections: [] }], async () => ({ body: null, status: 200 }))
    const methods = actions.__proto__ as Record<string, unknown>
    expect(Object.getPrototypeOf(methods)).toBeNull()
    expect(methods.constructor).toBe(actions['__proto__.constructor'])
    expect(Object.isFrozen(actions)).toBe(true)
  })
  it('shares both entry points and supports ID, aliases and concurrent calls', async () => {
    const seen: unknown[] = []
    const actions = createActions([action], async (payload) => {
      const selected = resolveAction([action], payload)
      seen.push(selected)
      return { body: selected.connectionId ?? null, status: 200 }
    })
    const call = actions[action.action] as (input: {}, options: { connectionId?: string; connectionAlias?: string }) => Promise<unknown>
    expect((actions.github as Record<string, unknown>).get_current_user).toBe(call)
    expect(await Promise.all([call({}, { connectionAlias: 'office' }), call({}, { connectionId: 'home' })])).toEqual(['work', 'home'])
    expect(seen).toHaveLength(2)
    expect(Object.getPrototypeOf(actions)).toBeNull()
    expect(Object.isFrozen(actions.github)).toBe(true)
  })
  it('uses a fixed default and permits public actions', () => {
    expect(resolveAction([{ ...action, connectionId: 'work' }], { action: action.action, input: {} }).connectionId).toBe('work')
    expect(resolveAction([{ ...action, connections: [] }], { action: action.action, input: {} }).connectionId).toBeUndefined()
  })
  it.each([
    { action: 'other.action', input: {} },
    { action: action.action, input: {} },
    { action: action.action, input: {}, options: { connectionId: 'other' } },
    { action: action.action, input: {}, options: { connectionAlias: 'other' } },
    { action: action.action, input: {}, options: { connectionId: 'work', connectionAlias: 'office' } },
    { action: action.action, input: {}, options: null },
    { action: action.action, input: {}, teamId: 'other' },
  ])('rejects unauthorized or malformed selection %j', (payload) => {
    expect(() => resolveAction([action], payload)).toThrow()
  })
})
