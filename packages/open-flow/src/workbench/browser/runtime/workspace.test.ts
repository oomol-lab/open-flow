import { describe, expect, it } from 'vitest'
import { providerIcon } from './providerIcon.ts'
import { designerGraph, setComment, setFlowViewport, setNodePositions } from './workspace.ts'

describe('Designer port projection', () => {
  it('ignores malformed remote edges instead of throwing', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [null, {}, { source: 'first', target: 'second' }, { source: 1, target: 'second' }] as never,
            nodes: {
              first: { inputs: {}, kind: 'value', name: 'First', values: [] },
              second: { inputs: {}, kind: 'value', name: 'Second', values: [] },
            },
          },
          subflows: {},
          tasks: {},
        },
        modelVersion: 1,
        modules: {},
      },
      createdAt: '2026-09-08T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    }

    expect(designerGraph(draft, { kind: 'flow' })).toMatchObject({
      edges: [expect.objectContaining({ source: 'first', target: 'second' })],
      nodes: [expect.objectContaining({ id: 'first' }), expect.objectContaining({ id: 'second' })],
    })

    const missing = {
      ...draft,
      content: {
        ...draft.content,
        document: { ...draft.content.document, graph: { ...draft.content.document.graph, edges: undefined as never } },
      },
    }
    expect(designerGraph(missing, { kind: 'flow' })).toMatchObject({ edges: [], nodes: expect.any(Array) })
  })

  it('preserves revision port order', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              task: {
                inputs: {},
                kind: 'task',
                task: {
                  inputs: [{ group: 'Request' }, { handle: 'second', jsonSchema: {}, nullable: false }, { handle: 'first', jsonSchema: {}, nullable: false }],
                  moduleId: 'module',
                  name: 'Task',
                  outputs: [
                    { handle: 'result-z', jsonSchema: {}, nullable: false },
                    { group: 'Other', collapsed: true },
                    { handle: 'result-a', jsonSchema: {}, nullable: false },
                  ],
                },
              },
            },
          },
          subflows: {},
          tasks: {},
        },
        modelVersion: 1,
        modules: { module: { imports: [], name: 'Task', source: 'export default () => ({})' } },
      },
      createdAt: '2026-08-27T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    }

    const node = designerGraph(draft, { kind: 'flow' }).nodes[0]
    if (node == null || node.kind == 'comment') throw new Error('Expected a Task node.')

    expect(node.inputs).toEqual([{ group: 'Request' }, expect.objectContaining({ handle: 'second' }), expect.objectContaining({ handle: 'first' })])
    expect(node.outputs).toEqual([
      expect.objectContaining({ handle: 'result-z' }),
      { collapsed: true, group: 'Other' },
      expect.objectContaining({ handle: 'result-a' }),
    ])
  })

  it('only requires a Connection for authenticated Connector Actions', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              news: {
                additionalInputs: [{ handle: 'start', jsonSchema: {}, nullable: false }],

                inputs: {},
                kind: 'task',
                taskId: 'news',
              },
            },
          },
          subflows: {},
          tasks: {
            news: {
              executor: { action: 'hacker-news.get-ask-stories', kind: 'connector' },
              inputs: [],
              name: 'Get Ask Stories',
              outputs: [],
            },
          },
        },
        modelVersion: 1,
        modules: {},
      },
      createdAt: '2026-08-31T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    }
    const action = {
      actionId: 'hacker-news.get-ask-stories',
      authenticated: false,
      description: 'Get Ask HN stories.',
      inputs: {},
      name: 'Get Ask Stories',
      outputs: {},
      serviceId: 'hacker-news',
      serviceName: 'Hacker News',
    }

    const publicNode = designerGraph(draft, { kind: 'flow' }, {}, [], { [action.actionId]: action }).nodes[0]
    const authenticatedNode = designerGraph(
      draft,
      { kind: 'flow' },
      {},
      [
        {
          code: 'task.connector-connection-required',
          column: 0,
          line: 1,
          message: 'Connector Task "news" requires an active Connection.',
          path: '/document/tasks/news/executor/connectionId',
          values: { taskId: 'news' },
        },
      ],
      { [action.actionId]: { ...action, authenticated: true } },
    ).nodes[0]

    expect(publicNode).toMatchObject({
      additionalInputs: [{ handle: 'start', jsonSchema: {}, nullable: false }],
      diagnostics: 0,
      executorName: 'connector',
    })
    expect(authenticatedNode).toMatchObject({ diagnostics: 1, executorName: 'connection required' })
  })

  it('projects a Wait notification summary from its Connector Action', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              wait: {
                actions: ['approve', 'reject'],

                input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
                inputs: {},
                kind: 'wait',
                notification: { inputs: {}, messageHandle: 'text', taskId: 'notify' },
                prompt: 'Review this request.',
              },
            },
          },
          subflows: {},
          tasks: {
            notify: {
              executor: { action: 'feishu.send-text-message', kind: 'connector' },
              inputs: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false }],
              name: 'send_text_message',
              outputs: [],
            },
          },
        },
        modelVersion: 1,
        modules: {},
      },
      createdAt: '2026-09-02T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    }
    const action = {
      actionId: 'feishu.send-text-message',
      authenticated: true,
      description: 'Send a text message.',
      inputs: {},
      name: 'Send text message',
      outputs: {},
      serviceId: 'feishu-custom-bot',
      serviceName: 'Feishu Custom Bot',
    }

    expect(designerGraph(draft, { kind: 'flow' }).nodes[0]).toMatchObject({ notice: { text: 'Notification · send text message' } })
    expect(designerGraph(draft, { kind: 'flow' }, {}, [], { [action.actionId]: action }).nodes[0]).toMatchObject({
      notice: {
        icon: providerIcon(action),
        text: 'Notification · Feishu Custom Bot · Send text message',
      },
    })

    const waiting = {
      closureDigest: 'closure',
      createdAt: '2026-09-02T00:00:00.000Z',
      engineContract: 'open-flow-engine/v2',
      engineDigest: 'sha256:engine',
      flowId: draft.flowId,
      modelVersion: 1,
      revisionDigest: draft.digest,
      revisionId: draft.revisionId,
      runId: 'run',
      source: 'draft',
      startedAt: '2026-09-02T00:00:01.000Z',
      status: 'waiting',
      version: 1,
      waiting: {
        actions: ['approve', 'reject'],
        expiresAt: '2026-09-09T00:00:02.000Z',
        nodeId: 'wait',
        prompt: 'Review this request.',
        waitId: '123456789012345678901',
        waitingSince: '2026-09-02T00:00:02.000Z',
      },
    } as const
    expect(designerGraph(draft, { kind: 'flow' }, {}, [], {}, {}, undefined, waiting).nodes[0]).toMatchObject({ run: { status: 'waiting' } })
  })

  it('keeps trigger configuration editing outside the canvas projection', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              trigger: {
                bindingId: 'binding',
                config: { repo: 'open-flow' },
                definition: {
                  configSchema: {
                    properties: { owner: { type: 'string' }, repo: { type: 'string' } },
                    required: ['owner', 'repo'],
                    type: 'object',
                  },
                  definitionVersion: 1,
                  description: '',
                  displayName: 'Repository event',
                  endpoint: {
                    body: { allowArray: false, allowEmpty: false, formats: ['json'] },
                    methods: ['POST'],
                    successStatus: 200,
                  },
                  key: 'github.on_repo_event',
                  name: 'on_repo_event',
                  payloadSchema: { type: 'object' },
                  provider: 'github',
                  type: 'integration',
                },
                kind: 'integration',
                name: 'Repository event',
              },
            },
          },
          subflows: {},
          tasks: {},
        },
        modelVersion: 1,
        modules: {},
      },
      createdAt: '2026-09-01T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    }
    const node = designerGraph(draft, { kind: 'flow' }, {}, [
      {
        code: 'trigger.config-incomplete',
        column: 0,
        line: 1,
        message: 'Complete the required Trigger config fields: owner.',
        path: '/document/graph/nodes/trigger/config',
        values: { fields: 'owner' },
      },
    ]).nodes[0]

    expect(designerGraph(draft, { kind: 'flow' }, {}, []).nodes[0]).toEqual(node)

    expect(node).toMatchObject({
      icon: providerIcon({ serviceId: 'github', serviceName: 'github' }),
      kind: 'trigger',
      presentation: { kind: 'integration', source: 'github' },
    })
    const trigger = draft.content.document.graph.nodes.trigger
    if (trigger?.kind != 'integration') throw new Error('Expected integration trigger.')
    const filled = {
      ...draft,
      content: {
        ...draft.content,
        document: {
          ...draft.content.document,
          graph: { ...draft.content.document.graph, nodes: { trigger: { ...trigger, config: { ...trigger.config, owner: 'owner' } } } },
        },
      },
    }
    expect(designerGraph(filled, { kind: 'flow' }, {}, []).nodes[0]).toEqual(node)
    expect(node).not.toHaveProperty('presentation.config')
  })
})

describe('Designer presentation', () => {
  it('preserves positions and comments while replacing the single viewport', () => {
    const target = { kind: 'flow' } as const
    const noted = setComment({}, target, 'note', { title: 'Note', content: 'Body', position: { x: 15, y: 25 } })
    const positioned = setNodePositions(noted, target, { task: { x: 30, y: 40 } })
    const moved = setFlowViewport(positioned, target, { x: 10, y: 20, zoom: 0.8 })
    expect(moved).toMatchObject({
      designer: {
        flow: {
          viewport: { x: 10, y: 20, zoom: 0.8 },
          nodes: { note: { x: 15, y: 25 }, task: { x: 30, y: 40 } },
          order: ['note', 'task'],
          comments: { note: { title: 'Note', content: 'Body' } },
        },
      },
    })
    expect(setFlowViewport(moved, target, { x: 10, y: 20, zoom: 0.8 })).toBe(moved)
  })

  it('keeps later nodes above earlier nodes regardless of their IDs', () => {
    const target = { kind: 'flow' } as const
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              'a-new': { inputs: {}, kind: 'value', name: 'New', values: [] },
              'z-old': { inputs: {}, kind: 'value', name: 'Old', values: [] },
            },
          },
          subflows: {},
          tasks: {},
        },
        modelVersion: 1,
        modules: {},
      },
      createdAt: '2026-09-08T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    }
    const old = setNodePositions({}, target, { 'z-old': { x: 0, y: 0 } })
    const current = setNodePositions(old, target, { 'a-new': { x: 24, y: 24 } })

    expect(designerGraph(draft, target, current).nodes.map((node) => node.id)).toEqual(['z-old', 'a-new'])
  })

  it('keeps independent viewports for the root graph and a subflow', () => {
    const root = setFlowViewport({}, { kind: 'flow' }, { x: 0, y: 0, zoom: 1 })
    const child = setFlowViewport(root, { kind: 'subflow', id: 'child' }, { x: 50, y: 60, zoom: 0.5 })
    expect(child).toMatchObject({
      designer: {
        flow: { viewport: { x: 0, y: 0, zoom: 1 } },
        subflows: { child: { viewport: { x: 50, y: 60, zoom: 0.5 } } },
      },
    })
  })
})

describe('Canvas run records', () => {
  const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
    actorId: 'actor',
    createdAt: '2026-09-05T01:00:00Z',
    digest: 'digest',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'revision',
    version: 1,
    content: {
      modelVersion: 1,
      modules: { module: { imports: [], name: 'Task', source: 'export default () => ({ result: 42 })' } },
      document: {
        bindings: {},
        subflows: {},
        tasks: {},
        graph: {
          edges: [],
          nodes: {
            task: {
              kind: 'task',
              inputs: {},
              task: { name: 'Task', moduleId: 'module', inputs: [], outputs: [{ handle: 'result', jsonSchema: {}, nullable: false }] },
            },
          },
        },
      },
    },
  }
  const run = {
    createdAt: draft.createdAt,
    flowId: draft.flowId,
    revisionId: draft.revisionId,
    runId: 'run',
    source: 'draft',
    status: 'completed',
    version: 1,
  } as const
  const events: NonNullable<Parameters<typeof designerGraph>[8]> = [
    { sequence: 1, kind: 'run.started', createdAt: draft.createdAt, payload: { flowId: 'flow', scopeId: 'root' } },
    {
      sequence: 2,
      kind: 'node.started',
      createdAt: '2026-09-05T01:00:01Z',
      payload: { flowId: 'flow', scopeId: 'root', executionId: 'task-job', nodeId: 'task' },
    },
    {
      sequence: 3,
      kind: 'node.log',
      createdAt: '2026-09-05T01:00:02Z',
      payload: { flowId: 'flow', scopeId: 'root', executionId: 'task-job', nodeId: 'task', level: 'info', message: 'Ready.' },
    },
    {
      sequence: 4,
      kind: 'node.completed',
      createdAt: '2026-09-05T01:00:03Z',
      payload: { flowId: 'flow', scopeId: 'root', executionId: 'task-job', nodeId: 'task', outputs: { result: 42 } },
    },
    {
      sequence: 5,
      kind: 'node.completed',
      createdAt: '2026-09-05T01:00:04Z',
      payload: { flowId: 'child', scopeId: 'child', executionId: 'child-job', nodeId: 'task', outputs: { result: 'nested' } },
    },
  ]
  it('keeps output, logs and timing together for the selected root execution', () => {
    expect(designerGraph(draft, { kind: 'flow' }, {}, [], {}, {}, undefined, run, events).nodes[0]).toMatchObject({
      run: {
        runId: 'run',
        status: 'success',
        outputs: { result: 42 },
        startedAt: events[1]?.createdAt,
        finishedAt: events[3]?.createdAt,
        logs: [{ level: 'info', message: 'Ready.' }],
      },
    })
  })
  it('does not attach historical results to a changed draft', () => {
    const node = designerGraph({ ...draft, revisionId: 'changed' }, { kind: 'flow' }, {}, [], {}, {}, undefined, run, events).nodes[0]
    expect(node).not.toHaveProperty('run')
  })
})

it('projects Agent tool icons with action labels and preserves separate actions from the same app', () => {
  const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
    actorId: 'actor',
    createdAt: '2026-09-09T00:00:00.000Z',
    digest: 'digest',
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: 'revision',
    version: 1,
    content: {
      modelVersion: 1,
      modules: {},
      document: {
        bindings: {},
        subflows: {},
        tasks: {
          agent: {
            name: 'Agent',
            inputs: [],
            outputs: [{ handle: 'output', jsonSchema: { type: 'string' }, nullable: false }],
            executor: {
              kind: 'agent',
              model: 'test',
              prompt: { kind: 'value', value: 'Read mail' },
              system: '',
              maxRounds: 10,
              tools: [
                { id: 'fetch', name: 'fetch', description: 'Fetch mail', action: 'gmail.fetch_emails', approval: false, inputs: [] },
                { id: 'send', name: 'send', description: 'Send mail', action: 'gmail.send_email', approval: true, inputs: [] },
              ],
            },
          },
        },
        graph: { edges: [], nodes: { agent: { kind: 'task', taskId: 'agent', inputs: {} } } },
      },
    },
  }
  const first = designerGraph(draft, { kind: 'flow' }).nodes[0]
  expect(first).toMatchObject({
    tools: [
      { id: 'fetch', label: 'gmail · fetch_emails', icon: providerIcon({ serviceId: 'gmail', serviceName: 'gmail' }) },
      { id: 'send', label: 'gmail · send_email', icon: providerIcon({ serviceId: 'gmail', serviceName: 'gmail' }) },
    ],
  })
  const agent = draft.content.document.tasks.agent!
  if (agent.executor.kind != 'agent') throw new Error('Expected Agent.')
  const removed = {
    ...draft,
    content: {
      ...draft.content,
      document: { ...draft.content.document, tasks: { agent: { ...agent, executor: { ...agent.executor, code: true, tools: [] } } } },
    },
  }
  expect(designerGraph(removed, { kind: 'flow' }).nodes[0]).toMatchObject({ tools: [] })
})
