import type { ConnectorActionCapability, ConnectorCapability, RevisionContent } from '../src/flow/common/change.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/engineContract.ts'
import { createActions, resolveAction } from '../src/execution/common/runtime.ts'
import { applyFlowChanges, decodeConnectorCapabilities } from '../src/flow/common/change.ts'
import { digestBytes, encodeRevision } from '../src/flow/common/encoding.ts'
import { createCodeTask, setCodeActions } from '../src/flow/common/nodeChanges.ts'
import { codeActions, flowClosure, prepareFlow } from '../src/flow/common/semantics.ts'

const target = { kind: 'flow' } as const
const capability: ConnectorCapability = { kind: 'connector' }
const legacyAction: ConnectorActionCapability = {
  kind: 'connector',
  action: 'github.get_current_user',
  connections: [{ connectionId: 'work', alias: 'office' }, { connectionId: 'home' }],
}

function revision(): RevisionContent {
  return applyFlowChanges(
    { document: { bindings: {}, graph: { edges: [], nodes: {} }, subflows: {}, tasks: {} }, modules: {}, modelVersion: currentFlowModelVersion },
    createCodeTask(target, { nodeId: 'code', moduleId: 'code' }, 'Code'),
  )
}

describe('Code Connector capability', () => {
  it('decodes the coarse capability and non-authorizing Connection hints', () => {
    const hinted = {
      kind: 'connector' as const,
      actionHints: ['github.get_current_user'],
      connectionHints: [
        { action: 'github.get_current_user', connectionId: 'work' },
        { action: 'github.get_current_user', connectionId: 'home', alias: 'personal' },
      ],
    }
    expect(decodeConnectorCapabilities([capability])).toEqual([capability])
    expect(decodeConnectorCapabilities([hinted])).toEqual([hinted])
    expect(decodeConnectorCapabilities([legacyAction])).toEqual([legacyAction])
  })

  it.each([
    null,
    [{ kind: 'connector', extra: true }],
    [capability, capability],
    [{ kind: 'connector', connectionHints: null }],
    [{ kind: 'connector', actionHints: null }],
    [{ kind: 'connector', actionHints: ['github'] }],
    [{ kind: 'connector', actionHints: ['github.user', 'github.user'] }],
    [{ kind: 'connector', connectionHints: [{ action: 'github', connectionId: 'work' }] }],
    [{ kind: 'connector', connectionHints: [{ action: 'github.user', connectionId: '' }] }],
    [{ kind: 'connector', connectionHints: [{ action: 'github.user', connectionId: 'work', alias: '' }] }],
    [
      {
        kind: 'connector',
        connectionHints: [
          { action: 'github.user', connectionId: 'work', alias: 'same' },
          { action: 'github.user', connectionId: 'home', alias: 'same' },
        ],
      },
    ],
  ])('rejects invalid declarations %j', (value) => {
    expect(() => decodeConnectorCapabilities(value)).toThrow()
  })

  it('saves the capability without losing source and rejects stale edits', () => {
    const source = revision()
    const operations = setCodeActions(source, target, 'code', [capability])
    if (operations == null) throw new Error('Expected capability edit.')
    const saved = applyFlowChanges(source, operations)
    expect(saved.modules).toEqual(source.modules)
    expect(saved.document.graph.nodes.code).toMatchObject({ task: { capabilities: [capability] } })
    expect(setCodeActions(saved, target, 'code', [capability])).toBeUndefined()
    expect(() => applyFlowChanges(saved, operations)).toThrow(/changed/)
  })

  it('preserves hints in canonical serialization and includes them in the digest', async () => {
    const source = revision()
    const variants: readonly ConnectorCapability[] = [
      capability,
      { kind: 'connector', actionHints: ['github.user'] },
      { kind: 'connector', connectionHints: [{ action: 'github.user', connectionId: 'work' }] },
      { kind: 'connector', connectionHints: [{ action: 'github.user', connectionId: 'work', alias: 'office' }] },
    ]
    const contents = variants.map((value) => {
      const changes = setCodeActions(source, target, 'code', [value])
      if (changes == null) throw new Error('Expected capability edit.')
      return applyFlowChanges(source, changes)
    })
    const digests = await Promise.all(contents.map((content) => digestBytes(encodeRevision(content))))
    expect(new Set(digests).size).toBe(4)
    const closures = await Promise.all(contents.map(flowClosure))
    expect(new Set(closures.map((closure) => closure.digest)).size).toBe(4)
    for (const content of contents) {
      const decoded = JSON.parse(new TextDecoder().decode(encodeRevision(content))) as RevisionContent
      expect(decoded).toEqual({ ...content, kind: 'open-flow-flow-revision', version: 1 })
    }
  })

  it('collects the capability from referenced Subflows and excludes unused definitions', async () => {
    const source = revision()
    const subflow = { name: 'Child', inputs: [], outputs: [], graph: { ...source.document.graph, nodes: { ...source.document.graph.nodes } } }
    const child = source.document.graph.nodes.code
    if (child?.kind != 'task' || child.task == null) throw new Error('Expected Code node.')
    subflow.graph.nodes.code = { ...child, task: { ...child.task, capabilities: [capability] } }
    const prepared = await prepareFlow(
      {
        ...source,
        document: {
          ...source.document,
          graph: { edges: [], nodes: { child: { kind: 'subflow', subflowId: 'child', inputs: {} } } },
          subflows: {
            child: subflow,
            unused: { ...subflow, graph: { edges: [], nodes: { code: { ...child, task: { ...child.task, capabilities: [capability] } } } } },
          },
        },
      },
      currentEngineContract,
    )
    expect(prepared.kind).toBe('prepared')
    if (prepared.kind != 'prepared') throw new Error('Expected prepared Subflow.')
    expect(codeActions(prepared.flow)).toEqual([capability])
  })
})

describe('Code Connector calls', () => {
  it('exposes dynamic full-ID, provider and explicit call entry points', async () => {
    const seen: unknown[] = []
    const actions = createActions(async (payload) => {
      seen.push(payload)
      return { body: payload, status: 200 }
    })
    const full = actions['github.get_current_user'] as (input: {}) => Promise<unknown>
    const nested = (actions.github as Record<string, unknown>).get_current_user as (input: {}) => Promise<unknown>
    const call = actions.call as (action: string, input: {}) => Promise<unknown>
    await Promise.all([full({}), nested({}), call('slack.post_message', {})])
    expect(seen).toEqual([
      { action: 'github.get_current_user', input: {} },
      { action: 'github.get_current_user', input: {} },
      { action: 'slack.post_message', input: {} },
    ])
    expect(full).toBe((actions.github as Record<string, unknown>).get_current_user)
    expect(Object.getPrototypeOf(actions)).toBeNull()
    expect(Object.isFrozen(actions)).toBe(true)
  })

  it('keeps special property names as ordinary frozen methods', () => {
    const actions = createActions(async () => ({ body: null, status: 200 }))
    const methods = actions.__proto__ as Record<string, unknown>
    expect(Object.getPrototypeOf(methods)).toBeNull()
    expect(methods.constructor).toBe(actions['__proto__.constructor'])
    expect(Object.isFrozen(methods)).toBe(true)
  })

  it('permits dynamic Actions and explicit Connection IDs without a node-level switch', () => {
    expect(resolveAction([], { action: 'other.action', input: {}, options: { connectionId: 'other' } })).toEqual({
      action: 'other.action',
      connectionId: 'other',
      input: {},
    })
  })

  it('preserves legacy aliases and defaults as non-authorizing hints', () => {
    expect(resolveAction([{ ...legacyAction, connectionId: 'work' }], { action: legacyAction.action, input: {} }).connectionId).toBe('work')
    expect(resolveAction([legacyAction], { action: legacyAction.action, input: {}, options: { connectionAlias: 'office' } }).connectionId).toBe('work')
    expect(resolveAction([legacyAction], { action: 'other.action', input: {}, options: { connectionId: 'outside' } }).connectionId).toBe('outside')
  })

  it.each([
    { capabilities: [capability], payload: { action: 'invalid', input: {} } },
    { capabilities: [capability], payload: { action: 'other.action', input: {}, options: { connectionAlias: 'missing' } } },
    { capabilities: [capability], payload: { action: 'other.action', input: {}, options: { connectionId: 'work', connectionAlias: 'office' } } },
    { capabilities: [capability], payload: { action: 'other.action', input: {}, options: null } },
    { capabilities: [capability], payload: { action: 'other.action', input: {}, teamId: 'other' } },
  ])('rejects malformed calls $payload', ({ capabilities, payload }) => {
    expect(() => resolveAction(capabilities, payload)).toThrow()
  })
})
