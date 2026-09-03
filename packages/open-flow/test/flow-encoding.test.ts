import type { JsonValue, RevisionContent } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, digestBytes, encodeRevision } from '../src/flow/common/encoding.ts'

const decoder = new TextDecoder()
const port = { jsonSchema: { type: 'number' }, nullable: false } as const

function revision(reverse = false): RevisionContent {
  const nodes = {
    condition: {
      cases: [
        {
          expressions: [
            { input: 'value', operator: '>=' as const, value: 10 },
            { input: 'value', operator: '<' as const, value: 20 },
          ],
          output: 'match',
          relation: 'all' as const,
        },
      ],
      concurrency: 1,
      defaultOutput: 'other',
      input: { ...port, handle: 'value' },
      inputs: { value: { kind: 'sources' as const, sources: [{ kind: 'node' as const, nodeId: 'value', output: 'value' }] } },
      kind: 'condition' as const,
    },
    value: { concurrency: 1, inputs: {}, kind: 'value' as const, values: [{ ...port, handle: 'value', value: 12 }] },
  }
  const modules = {
    helper: { imports: [], name: 'Helper', source: 'export const value = 1' },
    main: { imports: ['helper'], name: 'Main', source: 'export default () => value' },
  }
  return {
    document: {
      bindings: { variable: { kind: 'variable', target: 'TOKEN' } },
      graph: { nodes: reverse ? { value: nodes.value, condition: nodes.condition } : nodes },
      subflows: {
        child: {
          graph: { nodes: {} },
          inputs: [{ ...port, handle: 'input' }],
          name: 'Child',
          outputs: [{ ...port, handle: 'output', sources: [{ input: 'input', kind: 'flow' }] }],
        },
      },
      tasks: {
        managed: {
          executor: { kind: 'llm', mode: 'json' },
          inputs: [{ handle: 'prompt', jsonSchema: { type: 'string' }, nullable: false }],
          name: 'LLM',
          outputs: [],
        },
      },
    },
    modelVersion: 1,
    modules: reverse ? { main: modules.main, helper: modules.helper } : modules,
  }
}

describe('canonical JSON', () => {
  it('sorts every object lexicographically and preserves JSON encoding', () => {
    const value: JsonValue = {
      z: { b: 'β', a: '雪' },
      2: 'two',
      10: 'ten',
      a: ['line\nbreak', 'quote"', null, true, false, 1.25],
    }

    expect(decoder.decode(canonicalJsonBytes(value))).toBe(
      '{"10":"ten","2":"two","a":["line\\nbreak","quote\\\"",null,true,false,1.25],"z":{"a":"雪","b":"β"}}',
    )
  })

  it('produces the same bytes and digest regardless of insertion order', async () => {
    const first: JsonValue = { nested: { right: 2, left: 1 }, values: ['a', 'b'] }
    const second: JsonValue = { values: ['a', 'b'], nested: { left: 1, right: 2 } }

    const firstBytes = canonicalJsonBytes(first)
    const secondBytes = canonicalJsonBytes(second)

    expect(secondBytes).toEqual(firstBytes)
    await expect(digestBytes(secondBytes)).resolves.toBe('sha256:e82abf7fb412ce524b010b8808597b09110d289e17ddcf0b3e989b7001087f12')
  })
})

describe('Flow Revision encoding', () => {
  it('encodes a complete Revision independently of record insertion order', async () => {
    const first = encodeRevision(revision())
    const second = encodeRevision(revision(true))

    expect(second).toEqual(first)
    expect(JSON.parse(decoder.decode(first))).toMatchObject({
      document: {
        bindings: { variable: { kind: 'variable', target: 'TOKEN' } },
        graph: { nodes: { condition: {}, value: {} } },
        subflows: { child: { name: 'Child' } },
        tasks: { managed: { executor: { kind: 'llm', mode: 'json' }, name: 'LLM' } },
      },
      kind: 'open-flow-flow-revision',
      modelVersion: 1,
      modules: { helper: { imports: [] }, main: { imports: ['helper'] } },
      version: 1,
    })
    await expect(digestBytes(first)).resolves.toBe('sha256:fb5639eb4b28963502eb298e3ecfb9cc4c52a4be1e333896ac9fbee161fa1c09')
  })

  it('changes the encoded Revision when workflow semantics change', () => {
    const source = revision()
    const changed: RevisionContent = {
      ...source,
      document: { ...source.document, graph: { nodes: { ...source.document.graph.nodes, added: { concurrency: 1, inputs: {}, kind: 'value', values: [] } } } },
    }

    expect(encodeRevision(changed)).not.toEqual(encodeRevision(source))
  })

  it('encodes custom node icons', () => {
    const source = revision()
    const value = source.document.graph.nodes.value!
    if (value.kind != 'value') throw new Error('Expected a Value node.')
    const changed: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        graph: { nodes: { ...source.document.graph.nodes, value: { ...value, icon: ':carbon:star:' } } },
      },
    }

    expect(JSON.parse(decoder.decode(encodeRevision(changed)))).toMatchObject({
      document: { graph: { nodes: { value: { icon: ':carbon:star:' } } } },
    })
  })

  it('preserves Task port order', () => {
    const source = revision()
    const managed = source.document.tasks.managed!
    const changed: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        tasks: {
          managed: {
            ...managed,
            inputs: [
              { ...port, handle: 'value' },
              { ...port, handle: 'input' },
            ],
            outputs: [
              { ...port, handle: 'result' },
              { ...port, handle: 'detail' },
            ],
          },
        },
      },
    }

    expect(JSON.parse(decoder.decode(encodeRevision(changed)))).toMatchObject({
      document: { tasks: { managed: { inputs: [{ handle: 'value' }, { handle: 'input' }], outputs: [{ handle: 'result' }, { handle: 'detail' }] } } },
    })
  })

  it('preserves Value port order', () => {
    const source = revision()
    const value = source.document.graph.nodes.value!
    if (value.kind != 'value') throw new Error('Expected a Value node.')
    const changed: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        graph: {
          nodes: {
            ...source.document.graph.nodes,
            value: {
              ...value,
              values: [
                { ...port, handle: 'value' },
                { ...port, handle: 'detail' },
              ],
            },
          },
        },
      },
    }

    expect(JSON.parse(decoder.decode(encodeRevision(changed)))).toMatchObject({
      document: { graph: { nodes: { value: { values: [{ handle: 'value' }, { handle: 'detail' }] } } } },
    })
  })

  it('canonically encodes Wait actions and notification mappings', () => {
    const source = revision()
    const wait = {
      actions: ['approve', 'reject'],
      concurrency: 1,
      input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
      inputs: { value: { kind: 'value', value: { request: 1 } } },
      kind: 'wait',
      notification: {
        inputs: {
          recipient: { kind: 'value', value: 'ops@example.com' },
          subject: { kind: 'value', value: 'Approval required' },
        },
        messageHandle: 'message',
        taskId: 'notify',
      },
      prompt: 'Approve request 1?',
    } as const
    const first: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        graph: { nodes: { wait } },
      },
    }
    const second: RevisionContent = {
      ...first,
      document: {
        ...first.document,
        graph: {
          nodes: {
            wait: {
              ...wait,
              notification: {
                ...wait.notification,
                inputs: {
                  subject: wait.notification.inputs.subject,
                  recipient: wait.notification.inputs.recipient,
                },
              },
            },
          },
        },
      },
    }

    expect(encodeRevision(second)).toEqual(encodeRevision(first))
    expect(JSON.parse(decoder.decode(encodeRevision(first))).document.graph.nodes.wait).toEqual({
      actions: ['approve', 'reject'],
      concurrency: 1,
      input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
      inputs: { value: { kind: 'value', value: { request: 1 } } },
      kind: 'wait',
      notification: {
        inputs: {
          recipient: { kind: 'value', value: 'ops@example.com' },
          subject: { kind: 'value', value: 'Approval required' },
        },
        messageHandle: 'message',
        taskId: 'notify',
      },
      prompt: 'Approve request 1?',
    })
  })
})
