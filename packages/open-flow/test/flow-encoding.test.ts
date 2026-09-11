import type { JsonValue, RevisionContent } from '../src/flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { canonicalJsonBytes, digestBytes, encodeRevision, decodeRevision, decodeRevisionContent, decodeFlowDocument } from '../src/flow/common/encoding.ts'

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

      defaultOutput: 'other',
      input: { ...port, handle: 'value' },
      inputs: { value: { kind: 'sources' as const, sources: [{ kind: 'node' as const, nodeId: 'value', output: 'value' }] } },
      kind: 'condition' as const,
    },
    value: { inputs: {}, kind: 'value' as const, values: [{ ...port, handle: 'value', value: 12 }] },
  }
  const modules = {
    helper: { imports: [], name: 'Helper', source: 'export const value = 1' },
    main: { imports: ['helper'], name: 'Main', source: 'export default () => value' },
  }
  return {
    document: {
      bindings: { variable: { kind: 'variable', target: 'TOKEN' } },
      graph: { edges: [], nodes: reverse ? { value: nodes.value, condition: nodes.condition } : nodes },
      subflows: {
        child: {
          graph: { edges: [], nodes: {} },
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
        graph: { edges: [], nodes: { condition: {}, value: {} } },
        subflows: { child: { name: 'Child' } },
        tasks: { managed: { executor: { kind: 'llm', mode: 'json' }, name: 'LLM' } },
      },
      kind: 'open-flow-flow-revision',
      modelVersion: 1,
      modules: { helper: { imports: [] }, main: { imports: ['helper'] } },
      version: 1,
    })
    await expect(digestBytes(first)).resolves.toBe('sha256:9cea46b687eacdcf1ff19c131197d737d345e90b848a4679b6604dd77c2edd56')
  })

  it('changes the encoded Revision when workflow semantics change', () => {
    const source = revision()
    const changed: RevisionContent = {
      ...source,
      document: { ...source.document, graph: { edges: [], nodes: { ...source.document.graph.nodes, added: { inputs: {}, kind: 'value', values: [] } } } },
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
        graph: { edges: [], nodes: { ...source.document.graph.nodes, value: { ...value, icon: ':carbon:star:' } } },
      },
    }

    expect(JSON.parse(decoder.decode(encodeRevision(changed)))).toMatchObject({
      document: { graph: { edges: [], nodes: { value: { icon: ':carbon:star:' } } } },
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
          edges: [],
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
      document: { graph: { edges: [], nodes: { value: { values: [{ handle: 'value' }, { handle: 'detail' }] } } } },
    })
  })

  it('canonically encodes Wait actions and notification mappings', () => {
    const source = revision()
    const wait = {
      actions: ['approve', 'reject'],

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
        graph: { edges: [], nodes: { wait } },
      },
    }
    const second: RevisionContent = {
      ...first,
      document: {
        ...first.document,
        graph: {
          edges: [],
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

describe('Revision decoding', () => {
  it('round trips canonical bytes without changing the digest', () => {
    const bytes = encodeRevision(revision())
    expect(decodeRevision(bytes)).toEqual(revision())
    expect(encodeRevision(decodeRevision(bytes))).toEqual(bytes)
    expect(decodeRevisionContent(revision())).toEqual(revision())
    expect(decodeFlowDocument(revision().document)).toEqual(revision().document)
  })

  it('defaults missing legacy graph edges without mutating the input', () => {
    const content = revision()
    const legacy = JSON.parse(decoder.decode(encodeRevision(content)))
    delete legacy.document.graph.edges
    delete legacy.document.subflows.child.graph.edges

    expect(decodeFlowDocument(legacy.document)).toEqual(content.document)
    expect(decodeRevisionContent(legacy)).toEqual(content)
    const decoded = decodeRevision(new TextEncoder().encode(JSON.stringify(legacy)))
    expect(decoded).toEqual(content)
    expect(encodeRevision(decoded)).toEqual(encodeRevision(content))
    expect(legacy.document.graph).not.toHaveProperty('edges')
    expect(legacy.document.subflows.child.graph).not.toHaveProperty('edges')
  })

  it.each([undefined, null, 'invalid', { stale: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'missing', output: 'out' }] } }])(
    'ignores Value Node inputs while preserving execution edges: %j',
    (inputs) => {
      const content = revision()
      const outgoing = { source: 'value', target: 'condition' }
      const expectedGraph = { ...content.document.graph, edges: [{ source: 'start', target: 'value' }, outgoing] }
      const expected = {
        ...content,
        document: {
          ...content.document,
          graph: expectedGraph,
          subflows: { child: { ...content.document.subflows.child!, graph: expectedGraph } },
        },
      }
      const legacy = JSON.parse(decoder.decode(encodeRevision(expected)))
      for (const graph of [legacy.document.graph, legacy.document.subflows.child.graph]) {
        graph.nodes.value.inputs = inputs
      }
      const before = structuredClone(legacy)

      expect(decodeFlowDocument(legacy.document)).toEqual(expected.document)
      expect(decodeRevisionContent(legacy)).toEqual(expected)
      const decoded = decodeRevision(new TextEncoder().encode(JSON.stringify(legacy)))
      expect(decoded).toEqual(expected)
      expect(encodeRevision(decoded)).toEqual(encodeRevision(expected))
      expect(legacy).toEqual(before)
    },
  )

  it.each([null, {}, 'invalid', [{ source: 'a' }]])('rejects malformed graph edges: %j', (edges) => {
    const content = revision()
    expect(() => decodeFlowDocument({ ...content.document, graph: { ...content.document.graph, edges } })).toThrow()
    expect(() =>
      decodeFlowDocument({
        ...content.document,
        subflows: { child: { ...content.document.subflows.child, graph: { nodes: {}, edges } } },
      }),
    ).toThrow()
  })

  it('ignores unknown fields before validation and canonical encoding', () => {
    const content = {
      modelVersion: 1,
      modules: {},
      document: { bindings: {}, subflows: {}, tasks: {}, graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } } },
    } as const
    const extended = {
      ...content,
      extra: true,
      document: {
        ...content.document,
        extra: true,
        graph: { ...content.document.graph, extra: true, nodes: { start: { ...content.document.graph.nodes.start, inputs: {}, extra: true } } },
      },
    }
    expect(decodeFlowDocument(extended.document)).toEqual(content.document)
    expect(decodeRevisionContent(extended)).toEqual(content)
    const bytes = new TextEncoder().encode(JSON.stringify({ ...extended, kind: 'open-flow-flow-revision', version: 1 }))
    expect(decodeRevision(bytes)).toEqual(content)
    expect(encodeRevision(decodeRevision(bytes))).toEqual(encodeRevision(content))
    expect(extended.document.graph.nodes.start).toHaveProperty('inputs')
  })

  it.each([
    { version: 2 },
    { modelVersion: 2 },
    { kind: 'other' },
    { modules: { bad: { name: 'Bad', imports: [3], source: '' } } },
    { document: { ...revision().document, graph: { nodes: {}, edges: [{ source: 'a' }] } } },
  ])('rejects malformed or unsupported envelopes: %j', (patch) => {
    const value = { ...JSON.parse(decoder.decode(encodeRevision(revision()))), ...patch }
    expect(() => decodeRevision(new TextEncoder().encode(JSON.stringify(value)))).toThrow()
  })

  it('rejects invalid UTF-8, JSON, excessive nesting and non-JSON content', () => {
    expect(() => decodeRevision(new Uint8Array([255]))).toThrow()
    expect(() => decodeRevision(new TextEncoder().encode('{'))).toThrow()
    expect(() => decodeRevision(new TextEncoder().encode('['.repeat(66) + '0' + ']'.repeat(66)))).toThrow(/depth/)
    expect(() => decodeRevisionContent({ ...revision(), modules: undefined })).toThrow()
    expect(() => decodeFlowDocument({ ...revision().document, graph: { edges: [] } })).toThrow()
  })
})
