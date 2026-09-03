import { describe, expect, it } from 'vitest'
import { providerIcon } from './providerIcon.ts'
import { designerGraph, setFlowViewport, setNodePositions } from './workspace.ts'

describe('Designer port projection', () => {
  it('preserves revision port order', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
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

    const disabled = designerGraph(draft, { kind: 'flow' }, {}, [], {}, {}, undefined, undefined, [], [], false, false, false).nodes[0]
    if (disabled == null || disabled.kind == 'comment') throw new Error('Expected a Task node.')
    expect(disabled.inputs).toEqual([
      { group: 'Request' },
      expect.objectContaining({ handle: 'second', variableEnabled: false }),
      expect.objectContaining({ handle: 'first', variableEnabled: false }),
    ])
  })

  it('only requires a Connection for authenticated Connector Actions', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            nodes: {
              news: {
                additionalInputs: [{ handle: 'start', jsonSchema: {}, nullable: false }],
                concurrency: 1,
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
      editableAdditionalInputs: true,
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
            nodes: {
              wait: {
                actions: ['approve', 'reject'],
                concurrency: 1,
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
      engineContract: 'open-flow-engine/v1',
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

  it('projects missing Trigger config diagnostics onto their fields', () => {
    const draft: NonNullable<Parameters<typeof designerGraph>[0]> = {
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
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

    expect(node).toMatchObject({
      icon: providerIcon({ serviceId: 'github', serviceName: 'github' }),
      kind: 'trigger',
      presentation: {
        config: [expect.objectContaining({ invalid: true, name: 'owner' }), expect.objectContaining({ invalid: false, name: 'repo' })],
      },
    })
  })
})

describe('Designer presentation layouts', () => {
  it('stores positions independently for each display mode', () => {
    const target = { kind: 'flow' } as const
    const detail = setNodePositions({}, target, { task: { x: 10, y: 20 } }, 'detail')
    const overview = setNodePositions(detail, target, { task: { x: 30, y: 40 } }, 'overview')

    expect(overview).toMatchObject({
      designer: {
        flow: {
          layouts: {
            detail: { nodes: { task: { x: 10, y: 20 } } },
            overview: { nodes: { task: { x: 30, y: 40 } } },
          },
        },
      },
    })
  })

  it('persists a default-looking viewport when its display mode has no saved viewport', () => {
    const value = setFlowViewport({}, { kind: 'flow' }, { x: 0, y: 0, zoom: 1 }, 'overview')

    expect(value).toMatchObject({
      designer: { flow: { layouts: { overview: { viewport: { x: 0, y: 0, zoom: 1 } } } } },
    })
  })
})
