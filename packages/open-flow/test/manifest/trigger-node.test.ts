import type { Revision } from '../../src/base/common/revision.ts'
import type { FlowPath, SearchPath } from '../../src/manifest/common/manifestTypes.ts'
import type { NodeId } from '../../src/schema/index.ts'

import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { FlowEditOperationsSchema, planFlowEdit } from '../../src/manifest/common/flowEdit.ts'
import { WritableTriggerNodeManifest } from '../../src/manifest/common/writable/node/writableTriggerNodeManifest.ts'
import { WritableFlowManifest } from '../../src/manifest/common/writable/writableFlowManifest.ts'
import { FlowSchema, SubflowBlockSchema } from '../../src/schema/index.ts'
import { createMemoryPackage, memoryFile } from '../support/memory-package-meta.ts'

const triggerDefinition = {
  type: 'github.push',
  revision: '1',
  definition: {
    service_id: 'github',
    service_name: 'GitHub',
    name: 'Push',
    connector: {
      service_id: 'github',
      account_required: true,
    },
    config_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['repository'],
      properties: {
        repository: { type: 'string' },
      },
    },
    provisioning: { kind: 'webhook' },
    payload_schema: {
      type: 'object',
      additionalProperties: true,
      required: ['ref'],
      properties: {
        ref: { type: 'string' },
      },
    },
  },
} as const

const triggerNode = {
  node_id: 'github-push',
  trigger: {
    type: 'github.push',
    revision: '1',
    connection: 'github-work',
    config: {
      repository: 'oomol/open-flow',
    },
  },
} as const

const taskNode = {
  node_id: 'consume',
  task: {
    inputs_def: [{ handle: 'event' }],
    outputs_def: [],
    executor: {
      name: 'connector',
      options: { action: 'test.consume', connection: 'test-connection' },
    },
  },
} as const

describe('Trigger node authoring', () => {
  it('accepts the strict Trigger descriptor only in top-level Flows', () => {
    expect(FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [triggerNode] })).toEqual({
      trigger_definitions: [triggerDefinition],
      nodes: [triggerNode],
    })
    const displayed = {
      ...triggerNode,
      description: 'Runs when a push is received.',
      icon: './github.svg',
      ignore: true,
      title: 'Repository push',
    }
    expect(FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [displayed] })).toEqual({
      trigger_definitions: [triggerDefinition],
      nodes: [displayed],
    })
    expect(() => SubflowBlockSchema.parse({ nodes: [triggerNode] })).toThrow()

    for (const field of ['inputs_from', 'progress_weight', 'concurrency', 'timeout']) {
      expect(() =>
        FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [{ ...triggerNode, [field]: field == 'inputs_from' ? [] : 1 }] }),
      ).toThrow()
    }
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [{ ...triggerDefinition, definition: { ...triggerDefinition.definition, unknown: true } }],
        nodes: [triggerNode],
      }),
    ).toThrow(/Unrecognized key/)
  })

  it('rejects invalid Trigger identities and schemas while preserving incomplete authoring state', () => {
    const unconnected = { ...triggerNode, trigger: { ...triggerNode.trigger, connection: undefined } }
    expect(FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [unconnected] }).nodes[0]).toEqual(unconnected)
    expect(() =>
      FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [{ ...triggerNode, trigger: { ...triggerNode.trigger, type: '' } }] }),
    ).toThrow()
    expect(() =>
      FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [{ ...triggerNode, trigger: { ...triggerNode.trigger, revision: '' } }] }),
    ).toThrow()
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [
          {
            ...triggerDefinition,
            definition: {
              ...triggerDefinition.definition,
              config_schema: { type: 'object', oneOf: [{ type: 'object' }] },
            },
          },
        ],
        nodes: [triggerNode],
      }),
    ).toThrow()
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [
          {
            ...triggerDefinition,
            definition: { ...triggerDefinition.definition, payload_schema: { type: 'string' } },
          },
        ],
        nodes: [triggerNode],
      }),
    ).toThrow()
    const incomplete = { ...triggerNode, trigger: { ...triggerNode.trigger, config: {} } }
    expect(FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [incomplete] }).nodes[0]).toEqual(incomplete)
  })

  it('requires an explicit valid schedule only for poll Triggers', () => {
    const pollDefinition = {
      ...triggerDefinition,
      definition: {
        ...triggerDefinition.definition,
        provisioning: { kind: 'poll' as const },
      },
    }
    const integrationDefinition = {
      ...triggerDefinition,
      definition: {
        ...triggerDefinition.definition,
        provisioning: { kind: 'integration' as const },
      },
    }
    const pollNode = {
      ...triggerNode,
      trigger: {
        ...triggerNode.trigger,
        poll_times: [{ type: 'every' as const, unit: 'minute' as const, value: 5 }],
      },
    }

    expect(FlowSchema.parse({ trigger_definitions: [pollDefinition], nodes: [pollNode] }).nodes[0]).toEqual(pollNode)
    expect(() => FlowSchema.parse({ trigger_definitions: [pollDefinition], nodes: [triggerNode] })).toThrow(/requires exactly one poll time/)
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [pollDefinition],
        nodes: [{ ...pollNode, trigger: { ...pollNode.trigger, poll_times: [] } }],
      }),
    ).toThrow()
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [pollDefinition],
        nodes: [
          {
            ...pollNode,
            trigger: {
              ...pollNode.trigger,
              poll_times: [...pollNode.trigger.poll_times, { type: 'cron', expression: '0 * * * *', timezone: 'UTC' }],
            },
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [pollDefinition],
        nodes: [
          {
            ...pollNode,
            trigger: {
              ...pollNode.trigger,
              poll_times: [{ type: 'cron', expression: '* * * *', timezone: 'Asia/Shanghai' }],
            },
          },
        ],
      }),
    ).toThrow(/five-field cron expression/)
    expect(() => FlowSchema.parse({ trigger_definitions: [triggerDefinition], nodes: [pollNode] })).toThrow(/cannot define poll times/)
    expect(FlowSchema.parse({ trigger_definitions: [integrationDefinition], nodes: [triggerNode] }).nodes[0]).toEqual(triggerNode)
    expect(() => FlowSchema.parse({ trigger_definitions: [integrationDefinition], nodes: [pollNode] })).toThrow(/cannot define poll times/)
    expect(() =>
      FlowSchema.parse({
        trigger_definitions: [
          {
            ...integrationDefinition,
            definition: { ...integrationDefinition.definition, connector: undefined },
          },
        ],
        nodes: [{ ...triggerNode, trigger: { ...triggerNode.trigger, connection: undefined } }],
      }),
    ).toThrow(/requires a Connector connection/)
  })

  it('round-trips, edits, clones, and disposes a writable Trigger manifest', async () => {
    const manifest = new WritableFlowManifest(stringify({ trigger_definitions: [triggerDefinition], nodes: [triggerNode] }), 'revision-1' as Revision)
    const trigger = WritableTriggerNodeManifest.to(manifest.nodes.get('github-push' as NodeId))

    expect(trigger).toBeDefined()
    expect(trigger?.nodeType).toBe('trigger')
    expect(trigger?.$.trigger.value).toEqual(triggerNode.trigger)

    trigger?.$$.ignore.set(true)
    trigger?.$$.trigger.set({
      ...triggerNode.trigger,
      config: { repository: 'oomol/next' },
    })
    await Promise.resolve()

    expect(trigger?.toJSON()).toEqual({
      ...triggerNode,
      ignore: true,
      trigger: {
        ...triggerNode.trigger,
        config: { repository: 'oomol/next' },
      },
    })

    const clone = trigger?.clone('github-push-copy' as NodeId)
    expect(clone?.toJSON()).toEqual({
      ...trigger?.toJSON(),
      node_id: 'github-push-copy',
    })
    expect(clone?.$.trigger.value).toEqual(trigger?.$.trigger.value)

    clone?.dispose()
    manifest.dispose()
  })

  it('adds, replaces, connects, and removes Trigger nodes through shared Flow edits', () => {
    const operations = FlowEditOperationsSchema.parse([
      { type: 'add-trigger-definition', snapshot: triggerDefinition },
      { type: 'add-trigger-definition', snapshot: triggerDefinition },
      { type: 'add-node', node: triggerNode },
      { type: 'add-node', node: taskNode },
      {
        type: 'connect',
        connection: {
          from: { nodeId: 'github-push', handle: 'payload' },
          to: { nodeId: 'consume', handle: 'event' },
        },
      },
      {
        type: 'replace-node',
        node: {
          ...triggerNode,
          ignore: true,
          trigger: {
            ...triggerNode.trigger,
            config: { repository: 'oomol/next' },
          },
        },
      },
    ])
    const planned = planFlowEdit('nodes: []\n', operations)

    expect(planned.flow.trigger_definitions).toEqual([triggerDefinition])
    const refreshed = planFlowEdit(
      planned.source,
      FlowEditOperationsSchema.parse([
        {
          type: 'add-trigger-definition',
          snapshot: {
            ...triggerDefinition,
            definition: {
              ...triggerDefinition.definition,
              name: 'Repository push',
              service_name: 'GitHub Cloud',
            },
          },
        },
      ]),
    )
    expect(refreshed.flow.trigger_definitions?.[0]?.definition).toMatchObject({
      name: 'Repository push',
      service_name: 'GitHub Cloud',
    })
    expect(() =>
      planFlowEdit(
        refreshed.source,
        FlowEditOperationsSchema.parse([
          {
            type: 'add-trigger-definition',
            snapshot: {
              ...triggerDefinition,
              definition: {
                ...triggerDefinition.definition,
                payload_schema: { additionalProperties: false, type: 'object' },
              },
            },
          },
        ]),
      ),
    ).toThrow('conflicts with the existing snapshot')
    expect(planned.flow.nodes).toEqual([
      {
        ...triggerNode,
        ignore: true,
        trigger: {
          ...triggerNode.trigger,
          config: { repository: 'oomol/next' },
        },
      },
      {
        ...taskNode,
        task: { ...taskNode.task, inputs_def: [{ handle: 'event' }], outputs_def: [] },
        progress_weight: 1,
        inputs_from: [
          {
            handle: 'event',
            from_node: [{ node_id: 'github-push', output_handle: 'payload' }],
          },
        ],
      },
    ])

    expect(() => planFlowEdit(planned.source, FlowEditOperationsSchema.parse([{ type: 'remove-node', nodeId: 'github-push' }]))).toThrow(
      'Node "github-push" is still connected',
    )

    const removed = planFlowEdit(
      planned.source,
      FlowEditOperationsSchema.parse([
        {
          type: 'disconnect',
          connection: {
            from: { nodeId: 'github-push', handle: 'payload' },
            to: { nodeId: 'consume', handle: 'event' },
          },
        },
        { type: 'remove-node', nodeId: 'github-push' },
        {
          type: 'remove-trigger-definition',
          triggerType: triggerDefinition.type,
          revision: triggerDefinition.revision,
        },
      ]),
    )
    expect(removed.flow.nodes.map((node) => node.node_id)).toEqual(['consume'])
    expect(removed.flow.trigger_definitions).toBeUndefined()
  })

  it('rejects invalid Trigger connections at the edit boundary', () => {
    const source = stringify({ trigger_definitions: [triggerDefinition], nodes: [triggerNode, taskNode] })
    expect(() =>
      planFlowEdit(
        source,
        FlowEditOperationsSchema.parse([
          {
            type: 'connect',
            connection: {
              from: { nodeId: 'github-push', handle: 'unknown' },
              to: { nodeId: 'consume', handle: 'event' },
            },
          },
        ]),
      ),
    ).toThrow('only exposes the "payload" output')
    expect(() =>
      planFlowEdit(
        source,
        FlowEditOperationsSchema.parse([
          {
            type: 'connect',
            connection: {
              from: { nodeId: 'consume', handle: 'result' },
              to: { nodeId: 'github-push', handle: 'event' },
            },
          },
        ]),
      ),
    ).toThrow('does not accept input connections')
  })

  it('projects the definition name and payload output through Flow metadata', async () => {
    const root = '/workspace' as SearchPath
    const flowPath = `${root}/flows/main/flow.oo.yaml` as FlowPath
    const revision = 'revision-1' as Revision
    const { context, packageMeta } = createMemoryPackage({
      root,
      packageSource: '',
      packageRevision: revision,
      files: [memoryFile(flowPath, stringify({ trigger_definitions: [triggerDefinition], nodes: [triggerNode] }), revision)],
    })
    try {
      await packageMeta.flows.refreshAll()
      const node = packageMeta.flows.flowsByPath.get(flowPath)?.nodes.get('github-push' as NodeId)

      expect(node?.$.title.value).toBe('Push')
      expect(node?.$.allInputHandleDefs.value).toBeUndefined()
      expect(node?.$.allOutputHandleDefs.value).toEqual([
        {
          handle: 'payload',
          json_schema: triggerDefinition.definition.payload_schema,
        },
      ])
    } finally {
      packageMeta.dispose()
      context.dispose()
    }
  })
})
