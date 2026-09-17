import type { Draft } from '../api.ts'

import { describe, expect, it, vi } from 'vitest'
import * as graph from '../../../../flow/common/graph.ts'
import { revisionView } from '../revisionView.ts'

function draft(): Draft {
  return {
    actorId: 'test',
    createdAt: '2026-09-15T00:00:00.000Z',
    digest: 'd1',
    flowId: 'flow',
    modelVersion: 2,
    parentRevisionId: null,
    revisionId: 'r1',
    version: 1,
    content: {
      modelVersion: 2,
      modules: {},
      document: {
        bindings: {},
        subflows: {},
        tasks: {
          task: {
            name: 'Task',
            executor: { kind: 'connector', action: 'test' },
            inputs: Array.from({ length: 16 }, (_, index) => ({ handle: `input${index}`, jsonSchema: { type: 'string' }, nullable: true })),
            outputs: [],
          },
        },
        graph: {
          edges: [{ source: 'source', target: 'task' }],
          nodes: {
            source: {
              kind: 'value',
              inputs: {},
              values: [{ description: 'Plain text', handle: 'text', jsonSchema: { type: 'string' }, nullable: false, value: 'hello' }],
            },
            task: { kind: 'task', taskId: 'task', inputs: {} },
            other: { kind: 'task', taskId: 'task', inputs: {} },
          },
        },
      },
    },
  }
}

describe('Per-field input sources', () => {
  it('describes node outputs through the revision view', () => {
    const view = revisionView(draft())
    expect(view.outputDescription({ kind: 'flow' }, 'source', 'text')).toBe('Plain text')
    expect(view.outputDescription({ kind: 'flow' }, 'source', 'missing')).toBeUndefined()
    expect(view.outputDescription({ kind: 'subflow', id: 'missing' }, 'source', 'text')).toBeUndefined()
  })

  it('does no compatibility work until requested and caches each field independently', () => {
    const calculate = vi.spyOn(graph, 'inputSourceCandidates')
    const check = vi.spyOn(graph, 'checkInputSources')
    try {
      const view = revisionView(draft())
      const query = view.inputSource({ kind: 'flow' }, 'task', 'input0')
      expect(calculate).not.toHaveBeenCalled()
      expect(check).not.toHaveBeenCalled()
      expect(query.check()).toEqual({ conflict: false, sources: [] })
      expect(check).not.toHaveBeenCalled()
      expect(query.candidates()).toEqual({ source: [{ output: 'text', check: { kind: 'available' } }] })
      expect(calculate).toHaveBeenCalledTimes(1)
      expect(view.inputSource({ kind: 'flow' }, 'task', 'input0')).toBe(query)
      expect(query.candidates()).toBe(query.candidates())
      expect(calculate).toHaveBeenCalledTimes(1)
      view.inputSource({ kind: 'flow' }, 'task', 'input1').candidates()
      expect(calculate).toHaveBeenCalledTimes(2)
    } finally {
      calculate.mockRestore()
      check.mockRestore()
    }
  })

  it('checks only saved bindings, including missing and incompatible ports', () => {
    const base = draft()
    const source: Draft = {
      ...base,
      content: {
        ...base.content,
        document: {
          ...base.content.document,
          graph: {
            ...base.content.document.graph,
            nodes: {
              ...base.content.document.graph.nodes,
              task: {
                kind: 'task',
                taskId: 'task',
                inputs: {
                  input0: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'text' }] },
                  input1: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'missing' }] },
                },
              },
            },
          },
        },
      },
    }

    const calculate = vi.spyOn(graph, 'inputSourceCandidates')
    const check = vi.spyOn(graph, 'checkInputSources')
    try {
      const view = revisionView(source)
      expect(view.inputSource({ kind: 'flow' }, 'task', 'input0').check()).toEqual({ conflict: false, sources: [{ kind: 'available' }] })
      expect(view.inputSource({ kind: 'flow' }, 'task', 'input0').check()).toEqual({ conflict: false, sources: [{ kind: 'available' }] })
      expect(check).toHaveBeenCalledTimes(1)
      expect(view.inputSource({ kind: 'flow' }, 'task', 'input1').check()).toEqual({ conflict: false, sources: [{ kind: 'output-missing' }] })
      expect(calculate).not.toHaveBeenCalled()
      const changed: Draft = {
        ...source,
        content: {
          ...source.content,
          document: {
            ...source.content.document,
            tasks: {
              ...source.content.document.tasks,
              task: { ...source.content.document.tasks.task!, inputs: [{ handle: 'input0', jsonSchema: { type: 'number' }, nullable: true }] },
            },
          },
        },
      }

      expect(revisionView(changed).inputSource({ kind: 'flow' }, 'task', 'input0').check()).toEqual({
        conflict: false,
        sources: [{ kind: 'schema', mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'string', target: 'number' } }],
      })
      expect(revisionView(changed).inputSource({ kind: 'flow' }, 'task', 'input0').candidates()).toEqual({
        source: [
          {
            output: 'text',
            check: { kind: 'schema', mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'string', target: 'number' } },
          },
        ],
      })
    } finally {
      calculate.mockRestore()
      check.mockRestore()
    }
  })

  it('isolates node, graph and revision results', () => {
    const base = draft()
    const source: Draft = {
      ...base,
      content: {
        ...base.content,
        document: {
          ...base.content.document,
          subflows: {
            nested: { name: 'Nested', inputs: [], outputs: [], graph: { ...base.content.document.graph, edges: [] } },
          },
        },
      },
    }

    const view = revisionView(source)
    expect(view.inputSource({ kind: 'flow' }, 'task', 'input0').candidates()).toEqual({
      source: [{ output: 'text', check: { kind: 'available' } }],
    })
    expect(view.inputSource({ kind: 'flow' }, 'other', 'input0').candidates()).toEqual({})
    expect(view.inputSource({ kind: 'subflow', id: 'nested' }, 'task', 'input0').candidates()).toEqual({})
    const changed: Draft = {
      ...source,
      content: { ...source.content, document: { ...source.content.document, graph: { ...source.content.document.graph, edges: [] } } },
    }
    expect(revisionView(changed).inputSource({ kind: 'flow' }, 'task', 'input0').candidates()).toEqual({})
  })

  it('distinguishes a source that is not upstream from a schema mismatch', () => {
    const base = draft()
    const source: Draft = {
      ...base,
      content: {
        ...base.content,
        document: {
          ...base.content.document,
          graph: {
            ...base.content.document.graph,
            edges: [],
            nodes: {
              ...base.content.document.graph.nodes,
              task: {
                kind: 'task',
                taskId: 'task',
                inputs: { input0: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'text' }] } },
              },
            },
          },
        },
      },
    }

    expect(revisionView(source).inputSource({ kind: 'flow' }, 'task', 'input0').check()).toEqual({ conflict: false, sources: [{ kind: 'not-ready' }] })
  })

  it('allows sources supplied on separate incoming execution paths', () => {
    const base = draft()
    const source: Draft = {
      ...base,
      content: {
        ...base.content,
        document: {
          ...base.content.document,
          graph: {
            edges: [
              { source: 'source', target: 'task' },
              { source: 'second', target: 'task' },
            ],
            nodes: {
              ...base.content.document.graph.nodes,
              second: { kind: 'value', inputs: {}, values: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false, value: 'world' }] },
              task: {
                kind: 'task',
                taskId: 'task',
                inputs: {
                  input0: {
                    kind: 'sources',
                    sources: [
                      { kind: 'node', nodeId: 'source', output: 'text' },
                      { kind: 'node', nodeId: 'second', output: 'text' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    }

    expect(revisionView(source).inputSource({ kind: 'flow' }, 'task', 'input0').check()).toEqual({
      conflict: false,
      sources: [{ kind: 'available' }, { kind: 'available' }],
    })
  })
})
