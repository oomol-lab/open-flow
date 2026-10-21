import type { TFunction } from 'val-i18n'
import type { GraphNode, Group, NodeSource, Port, ResolutionNode, TaskDefinition, TriggerNode } from '../../../../flow/common/change.ts'
import type { InputSourceCandidate } from '../../../../flow/common/graph.ts'

import { waitBranchDescription } from '../../../../canvas/browser/i18n/waitBranchLocales.ts'
import { nodeErrorSchema, nodeSystemOutputPorts } from '../../../../flow/common/errorHandling.ts'
import { resolutionOutputPorts } from '../../../../flow/common/graph.ts'
import { schemaObject } from '../../../../flow/common/schema.ts'
import { sourcePort } from '../../../../flow/common/sourceField.ts'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'

/** Localized answer help is presentation-only; persisted Decision schemas stay language-neutral. */
export function presentDecisionOutputs(task: TaskDefinition, t: TFunction): readonly (Port | Group)[] {
  if (!('executor' in task) || task.executor.kind !== 'decision') return task.outputs
  const questions = new Map(task.executor.questions.map((question) => [question.name, question]))
  return task.outputs.map((port) => {
    if (!('handle' in port)) return port
    const question = questions.get(port.handle)
    const schema = schemaObject(port.jsonSchema)
    if (question == null || schema == null) return port
    const properties = Object.fromEntries(
      Object.entries(schemaObject(schema.properties ?? null) ?? {}).map(([name, value]) => {
        const field = schemaObject(value)
        if (field == null) return [name, value]
        let description: string
        switch (name) {
          case 'type':
            description = t('decision.outputs.type', { type: question.type })
            break
          case 'noul':
          case 'choice':
          case 'score':
          case 'confidence':
          case 'legend':
            description = t(`decision.outputs.${name}`)
            break
          case 'probabilities':
            description = t(`decision.outputs.${question.type}Probabilities`)
            break
          default:
            return [name, value]
        }
        const children = schemaObject(field.properties ?? null)
        return [
          name,
          {
            ...field,
            description,
            ...(children == null
              ? {}
              : {
                  properties: Object.fromEntries(
                    Object.entries(children).map(([key, child]) => [
                      key,
                      {
                        ...schemaObject(child),
                        description:
                          name === 'legend'
                            ? t('decision.outputs.level', { level: key })
                            : question.type === 'choice'
                              ? t('decision.outputs.choiceProbability', { name: key })
                              : t('decision.outputs.scoreProbability', { level: key }),
                      },
                    ]),
                  ),
                }),
          },
        ]
      }),
    )
    return {
      ...port,
      description: t('decision.outputs.answer', { type: t(`decision.${question.type}`) }),
      jsonSchema: { ...schema, properties },
    }
  })
}

/** Localized system help stays in presentation; persisted runtime schemas remain language-neutral. */
export function presentSystemOutputs(node: GraphNode, t: TFunction): readonly Port[] {
  return Object.entries(nodeSystemOutputPorts(node)).map(([handle, port]) =>
    Object.assign({ handle }, port, {
      description: t('inspector.node.errorFields.error'),
      jsonSchema: {
        ...nodeErrorSchema,
        properties: Object.fromEntries(
          Object.entries(nodeErrorSchema.properties).map(([name, field]) => [
            name,
            {
              ...field,
              description: t(`inspector.node.errorFields.${name}`),
            },
          ]),
        ),
      },
    }),
  )
}

function withDescriptions(ports: readonly Port[], descriptionFor: (handle: string) => string | undefined): readonly Port[] {
  return ports.map((port) => {
    const description = descriptionFor(port.handle)
    return description == null ? port : Object.assign({}, port, { description })
  })
}

/** Adds localized UI copy to built-in Trigger outputs without changing their runtime definitions. */
export function presentBuiltInTriggerOutputs(trigger: TriggerNode, t: TFunction): readonly Port[] {
  const ports = triggerOutputDefinitions(trigger)
  switch (trigger.kind) {
    case 'error':
      return withDescriptions(ports, (handle) => t(`errorWorkflow.${handle}`))
    case 'cron':
      return withDescriptions(ports, (handle) => (handle === 'scheduledAt' ? t('inspector.ports.builtIn.cron.scheduledAt') : undefined))
    case 'webhook':
      return withDescriptions(ports, (handle) => {
        switch (handle) {
          case 'headers':
            return t('inspector.ports.builtIn.webhook.headers')
          case 'query':
            return t('inspector.ports.builtIn.webhook.query')
          case 'body':
            return t('inspector.ports.builtIn.webhook.body')
          case 'webhookUrl':
            return t('inspector.ports.builtIn.webhook.webhookUrl')
          default:
            return
        }
      })
    default:
      return ports
  }
}

/** Adds canvas-owned branch copy to built-in Wait and Approval outputs for inspector display only. */
export function presentResolutionOutputs(node: ResolutionNode, t: TFunction): readonly Port[] {
  const ports = Object.entries(resolutionOutputPorts(node)).map(([handle, port]) => Object.assign({ handle }, port))
  return withDescriptions(ports, (handle) => waitBranchDescription(t, node.kind, handle))
}

function presentedBuiltInOutputs(node: GraphNode, t: TFunction): readonly Port[] | undefined {
  switch (node.kind) {
    case 'approval':
    case 'wait':
      return presentResolutionOutputs(node, t)
    case 'error':
    case 'cron':
    case 'webhook':
      return presentBuiltInTriggerOutputs(node, t)
    default:
      return
  }
}

/** Applies localized built-in output copy to source candidates without changing graph-owned data. */
export function presentBuiltInSourceCandidates(node: GraphNode, candidates: readonly InputSourceCandidate[], t: TFunction): readonly InputSourceCandidate[] {
  const outputs = presentedBuiltInOutputs(node, t)
  const systemOutputs = presentSystemOutputs(node, t)
  if (outputs == null && systemOutputs.length == 0) return candidates
  return candidates.map((candidate) => {
    const port = (candidate.system ? systemOutputs : outputs)?.find((item) => item.handle == candidate.output)
    if (port == null) return candidate
    const description = port.description ?? candidate.description
    const fields = candidate.system
      ? candidate.fields?.map((field) => Object.assign({}, field, { description: sourcePort(port, field.field)?.description }))
      : undefined
    if (fields == null && description == candidate.description) return candidate
    return Object.assign({}, candidate, { description }, fields == null ? {} : { fields })
  })
}

/** Returns localized built-in copy when available, otherwise preserving the port-owned description. */
export function presentBuiltInOutputDescription(
  node: GraphNode,
  output: string,
  description: string | undefined,
  t: TFunction,
  source?: Pick<NodeSource, 'system' | 'field'>,
): string | undefined {
  if (source?.system) {
    const port = presentSystemOutputs(node, t).find((item) => item.handle == output)
    return port == null ? description : (sourcePort(port, source.field)?.description ?? description)
  }
  return presentedBuiltInOutputs(node, t)?.find((port) => port.handle == output)?.description ?? description
}
