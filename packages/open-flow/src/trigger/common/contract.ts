import type { JsonValue, Port, PortDefinition, TriggerNode } from '../../flow/common/change.ts'

import { isJsonObject } from '../../base/common/json.ts'
import { matchesSchema } from '../../flow/common/schema.ts'
import { webhookMethods, webhookSupportsBody } from '../../flow/common/webhookMethod.ts'

export { webhookMethods, webhookSupportsBody }

export const errorOutputs: readonly Port[] = [
  {
    handle: 'workflow',
    nullable: false,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['flowId', 'name', 'revisionId', 'publicationId'],
      properties: { flowId: { type: 'string' }, name: { type: 'string' }, revisionId: { type: 'string' }, publicationId: { type: ['string', 'null'] } },
    },
  },
  {
    handle: 'execution',
    nullable: false,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['runId', 'status', 'startedAt', 'finishedAt'],
      properties: {
        runId: { type: 'string' },
        status: { enum: ['failed', 'indeterminate'] },
        startedAt: { type: ['string', 'null'] },
        finishedAt: { type: 'string' },
      },
    },
  },
  {
    handle: 'error',
    nullable: false,
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        nodeId: { type: 'string' },
        jobId: { type: 'string' },
        path: { type: 'array', items: { type: 'string' } },
      },
    },
  },
]

export const sampleErrorOutputs: Readonly<Record<string, JsonValue>> = {
  workflow: { flowId: 'example-flow', name: 'Example workflow', revisionId: 'example-revision', publicationId: 'example-publication' },
  execution: { runId: 'example-run', status: 'failed', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' },
  error: { code: 'node.failed', message: 'Example failure', nodeId: 'example-node', jobId: 'example-job', path: [] },
}

export const webhookOutputs: readonly Port[] = [
  { handle: 'headers', jsonSchema: { type: 'object', additionalProperties: { type: 'string' } }, nullable: false },
  { handle: 'query', jsonSchema: { type: 'object', additionalProperties: { type: ['string', 'array'], items: { type: 'string' } } }, nullable: false },
  { handle: 'body', jsonSchema: { type: 'object', additionalProperties: true }, nullable: false },
  { handle: 'webhookUrl', jsonSchema: { type: 'string' }, nullable: false },
]
const cronOutputs: readonly Port[] = [
  {
    handle: 'scheduledAt',
    jsonSchema: { type: 'string', format: 'date-time' },
    nullable: false,
  },
]

export function triggerOutputDefinitions(trigger: TriggerNode): readonly Port[] {
  switch (trigger.kind) {
    case 'error':
      return errorOutputs
    case 'manual':
      return []
    case 'cron':
      return cronOutputs
    case 'poll':
    case 'integration':
      return trigger.definition.outputs
    case 'webhook':
      return webhookOutputs
        .filter((port) => port.handle !== 'body' || webhookSupportsBody(trigger.method))
        .map((port) =>
          port.handle === 'body'
            ? Object.assign({}, port, {
                jsonSchema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: Object.fromEntries(trigger.bodyFields.map((field) => [field.handle, field.jsonSchema])),
                  required: trigger.bodyFields.filter((field) => !field.nullable && !Object.hasOwn(field, 'value')).map((field) => field.handle),
                },
              })
            : port,
        )
  }
}

export function triggerOutputPorts(trigger: TriggerNode): Readonly<Record<string, PortDefinition>> {
  return Object.fromEntries(triggerOutputDefinitions(trigger).map(({ handle, ...port }) => [handle, port]))
}

export function matchesTriggerOutputs(trigger: TriggerNode, outputs: unknown): outputs is Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(outputs)) return false
  const ports = triggerOutputDefinitions(trigger)
  return (
    new Set(ports.map((port) => port.handle)).size === ports.length &&
    Object.keys(outputs).length === ports.length &&
    ports.every(
      (port) =>
        Object.hasOwn(outputs, port.handle) && ((outputs[port.handle] === null && port.nullable) || matchesSchema(outputs[port.handle]!, port.jsonSchema)),
    )
  )
}
