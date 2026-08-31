import { z } from 'zod'
import { validateTriggerDefinitionSchemas } from '../trigger/common/definition.ts'
import { FlowNodeSchema, TriggerDefinitionSnapshotSchema } from './node.schema.ts'

export const FlowSchema = /* @__PURE__ */ z
  .strictObject({
    title: z.string().optional().describe('Flow display title'),
    description: z.string().optional().describe('Flow display description'),
    icon: z.string().optional().describe('Path to a icon image for the Flow'),
    trigger_definitions: z.array(TriggerDefinitionSnapshotSchema).optional().describe('Trigger definition snapshots referenced by Trigger Nodes'),
    nodes: z.array(FlowNodeSchema).describe('Nodes in Flow'),
  })
  .superRefine((flow, context) => {
    const nodes = new Map<string, (typeof flow.nodes)[number]>()
    const definitions = new Map<string, NonNullable<typeof flow.trigger_definitions>[number]>()
    for (const [index, snapshot] of (flow.trigger_definitions ?? []).entries()) {
      const key = JSON.stringify([snapshot.type, snapshot.revision])
      if (definitions.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate Trigger definition "${snapshot.type}" revision "${snapshot.revision}".`,
          path: ['trigger_definitions', index],
        })
      }
      definitions.set(key, snapshot)
    }

    for (const [index, node] of flow.nodes.entries()) {
      if (nodes.has(node.node_id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate node ID "${node.node_id}".`,
          path: ['nodes', index, 'node_id'],
        })
      }
      nodes.set(node.node_id, node)

      if ('trigger' in node) {
        const definition = definitions.get(JSON.stringify([node.trigger.type, node.trigger.revision]))?.definition
        if (definition == null) {
          context.addIssue({
            code: 'custom',
            message: `Trigger "${node.node_id}" references missing definition "${node.trigger.type}" revision "${node.trigger.revision}".`,
            path: ['nodes', index, 'trigger'],
          })
          continue
        }
        if (definition.connector == null && node.trigger.connection != null) {
          context.addIssue({
            code: 'custom',
            message: `Trigger "${node.node_id}" does not use a Connector connection.`,
            path: ['nodes', index, 'trigger', 'connection'],
          })
        }
        if (definition.provisioning.kind == 'poll' && definition.connector == null) {
          context.addIssue({
            code: 'custom',
            message: `Poll Trigger "${node.node_id}" requires a Connector connection.`,
            path: ['nodes', index, 'trigger', 'connection'],
          })
        }
        if (definition.provisioning.kind == 'integration' && definition.connector == null) {
          context.addIssue({
            code: 'custom',
            message: `Integration Trigger "${node.node_id}" requires a Connector connection.`,
            path: ['nodes', index, 'trigger', 'connection'],
          })
        }
        if (definition.provisioning.kind == 'poll' && node.trigger.poll_times == null) {
          context.addIssue({
            code: 'custom',
            message: `Poll Trigger "${node.node_id}" requires exactly one poll time.`,
            path: ['nodes', index, 'trigger', 'poll_times'],
          })
        } else if (definition.provisioning.kind != 'poll' && node.trigger.poll_times != null) {
          context.addIssue({
            code: 'custom',
            message: `${definition.provisioning.kind == 'webhook' ? 'Webhook' : 'Integration'} Trigger "${node.node_id}" cannot define poll times.`,
            path: ['nodes', index, 'trigger', 'poll_times'],
          })
        }
        try {
          validateTriggerDefinitionSchemas(
            {
              configSchema: definition.config_schema,
              payloadSchema: definition.payload_schema,
            },
            `Trigger definition "${node.trigger.type}" revision "${node.trigger.revision}"`,
          )
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : String(error),
            path: ['nodes', index, 'trigger'],
          })
        }
      }
    }

    for (const [nodeIndex, node] of flow.nodes.entries()) {
      if (!('inputs_from' in node)) continue
      for (const [inputIndex, input] of (node.inputs_from ?? []).entries()) {
        for (const [sourceIndex, source] of (input.from_node ?? []).entries()) {
          const sourceNode = nodes.get(source.node_id)
          if (sourceNode != null && 'trigger' in sourceNode && source.output_handle != 'payload') {
            context.addIssue({
              code: 'custom',
              message: `Trigger "${source.node_id}" only exposes the "payload" output.`,
              path: ['nodes', nodeIndex, 'inputs_from', inputIndex, 'from_node', sourceIndex, 'output_handle'],
            })
          }
        }
      }
    }
  })
  .describe('Flow defines a web of Blocks described by a series of Nodes')
