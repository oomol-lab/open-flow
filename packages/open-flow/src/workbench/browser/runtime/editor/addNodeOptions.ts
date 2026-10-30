import type { TFunction } from 'val-i18n'
import type { Draft, JsonValue, TriggerKeySnapshot } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { RevisionView } from '../revisionView.ts'
import type { AddNodeIntent } from './flowChanges.ts'

import { decisionTask } from '../../../../decision/common/decision.ts'
import { httpRequestTask } from '../../../../http/common/httpRequest.ts'
import { dedupeTask } from '../../../../state/common/state.ts'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'
import { revisionView } from '../revisionView.ts'

interface AddNodePort {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema: JsonValue
}

interface AddNodeOptionBase {
  readonly choices?: readonly {
    readonly description?: string
    readonly label: string
    readonly option: AddNodeOption
  }[]
  readonly description: string
  readonly group?: string
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly AddNodePort[]
  readonly label: string
  readonly outputs: readonly AddNodePort[]
}

type AddTrigger =
  | {
      readonly kind: 'catalog'
      readonly connectionId?: string
      readonly definition: TriggerKeySnapshot
    }
  | { readonly kind: 'connect'; readonly provider: string }
  | { readonly kind: 'start' }
  | { readonly kind: 'error' }
  | { readonly kind: 'cron' }
  | { readonly kind: 'webhook' }

export type AddNodeOption = AddNodeOptionBase &
  (
    | { readonly kind: 'comment' }
    | { readonly kind: 'approval' }
    | { readonly kind: 'condition' }
    | { readonly connector: ConnectorActionView; readonly kind: 'connector' }
    | {
        readonly choices: NonNullable<AddNodeOptionBase['choices']>
        readonly kind: 'connector-group'
        readonly noSetup?: boolean
        readonly serviceId: string
      }
    | { readonly kind: 'decision' }
    | { readonly kind: 'agent' }
    | { readonly kind: 'openapi' }
    | { readonly kind: 'http-request' }
    | { readonly kind: 'dedupe' }
    | { readonly kind: 'workflow' }
    | { readonly kind: 'llm' }
    | { readonly kind: 'new-task' }
    | {
        readonly choices: NonNullable<AddNodeOptionBase['choices']>
        readonly kind: 'trigger'
      }
    | { readonly kind: 'trigger'; readonly trigger: AddTrigger }
    | { readonly kind: 'value' }
    | { readonly kind: 'wait' }
    | { readonly kind: 'outputs' }
    | { readonly kind: 'webhook-response' }
  )

export function indexAddNodeOptions(options: readonly AddNodeOption[]): ReadonlyMap<string, AddNodeOption> {
  const indexed = new Map<string, AddNodeOption>()
  const visit = (option: AddNodeOption): void => {
    indexed.set(option.id, option)
    for (const choice of option.choices ?? []) visit(choice.option)
  }
  for (const option of options) visit(option)
  return indexed
}

function builtinOptions(_draft: Draft, t: TFunction): readonly AddNodeOption[] {
  const group = t('addNode.blocks')
  return [
    {
      description: t('addNode.javascriptDescription'),
      group,
      icon: ':carbon:code:',
      id: 'javascript',
      inputs: [{ handle: 'value', jsonSchema: { type: 'string' } }],
      kind: 'new-task',
      label: t('addNode.javascript'),
      outputs: [{ handle: 'result', jsonSchema: {} }],
    },
    {
      description: t('addNode.conditionDescription'),
      group,
      id: 'condition',
      icon: ':carbon:child-node:',
      inputs: [{ handle: 'value', jsonSchema: {} }],
      kind: 'condition',
      label: t('addNode.condition'),
      outputs: [
        { handle: 'false', jsonSchema: {} },
        { handle: 'true', jsonSchema: {} },
      ],
    },
    {
      description: t('addNode.agentDescription'),
      group,
      id: 'agent',
      icon: ':carbon:machine-learning-model:',
      inputs: [{ handle: 'input', jsonSchema: { type: 'string' } }],
      outputs: [{ handle: 'output', jsonSchema: { type: 'string' } }],
      kind: 'agent',
      label: t('addNode.agent'),
    },
    {
      description: t('decision.description'),
      group,
      id: 'decision',
      icon: ':carbon:ml-model-reference:',
      kind: 'decision',
      label: t('addNode.decision'),
      inputs: decisionTask().inputs.filter((port) => 'handle' in port),
      outputs: decisionTask().outputs.filter((port) => 'handle' in port),
    },
    {
      description: t('httpRequest.description'),
      group,
      icon: ':lucide-light:globe:',
      id: 'http-request',
      inputs: httpRequestTask().inputs.filter((port) => 'handle' in port),
      outputs: httpRequestTask().outputs.filter((port) => 'handle' in port),
      kind: 'http-request',
      label: t('httpRequest.title'),
    },
    {
      description: t('flowState.warning'),
      group,
      icon: ':lucide-light:list-filter:',
      id: 'dedupe',
      inputs: dedupeTask().inputs.filter((port) => 'handle' in port),
      outputs: dedupeTask().outputs.filter((port) => 'handle' in port),
      kind: 'dedupe',
      label: t('flowState.nodeTitle'),
    },
    { description: t('openapi.description'), group, icon: ':logos:openapi-icon:', id: 'openapi', inputs: [], outputs: [], kind: 'openapi', label: 'OpenAPI' },
    {
      description: t('addNode.valueDescription'),
      group,
      id: 'value',
      icon: ':oomol:value:',
      inputs: [],
      kind: 'value',
      label: t('addNode.value'),
      outputs: [{ handle: 'value', jsonSchema: {} }],
    },
    {
      description: t('workflow.description'),
      group,
      icon: ':lucide-light:workflow:',
      id: 'workflow',
      inputs: [],
      outputs: [],
      kind: 'workflow',
      label: t('addNode.workflow'),
    },
    {
      id: 'webhook-response',
      kind: 'webhook-response',
      group,
      label: t('addNode.webhookResponse'),
      description: t('addNode.webhookResponseDescription'),
      icon: ':lucide-light:reply:',
      inputs: [],
      outputs: [],
    },
    {
      id: 'outputs',
      kind: 'outputs',
      label: t('addNode.outputs'),
      description: t('addNode.outputsDescription'),
      group: t('addNode.blocks'),
      icon: ':lucide-light:log-out:',
      inputs: [],
      outputs: [],
    },
    {
      description: t('addNode.commentDescription'),
      group,
      id: 'comment',
      icon: ':codicon:note:',
      inputs: [],
      kind: 'comment',
      label: t('addNode.comment'),
      outputs: [],
    },
  ]
}

export function deriveAddNodeOptions(draft: Draft | undefined, t: TFunction): readonly AddNodeOption[] {
  if (draft == null) return []
  const options = builtinOptions(draft, t)
  const group = t('addNode.triggers')
  const triggers: readonly AddNodeOption[] = [
    {
      description: t('addNode.startDescription'),
      group,
      id: 'trigger:start',
      icon: ':carbon:play:',
      inputs: [],
      kind: 'trigger',
      label: t('addNode.start'),
      outputs: [],
      trigger: { kind: 'start' },
    },
    {
      description: t('addNode.webhookDescription'),
      group,
      id: 'trigger:webhook',
      icon: ':carbon:webhook:',
      inputs: [],
      kind: 'trigger',
      label: t('addNode.webhook'),
      outputs: triggerOutputDefinitions({ kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] }),
      trigger: { kind: 'webhook' },
    },
    {
      description: t('addNode.cronDescription'),
      group,
      id: 'trigger:cron',
      icon: ':carbon:time:',
      inputs: [],
      kind: 'trigger',
      label: t('addNode.cron'),
      outputs: triggerOutputDefinitions({ kind: 'cron', name: 'Cron', cronTimes: [] }),
      trigger: { kind: 'cron' },
    },
    {
      description: t('errorWorkflow.description'),
      group,
      id: 'trigger:error',
      icon: ':lucide-light:siren:',
      inputs: [],
      kind: 'trigger',
      label: t('errorWorkflow.trigger'),
      outputs: triggerOutputDefinitions({ kind: 'error', name: 'Flow Error' }),
      trigger: { kind: 'error' },
    },
    ...options,
    {
      description: t('addNode.approvalDescription'),
      group: t('addNode.humanInTheLoop'),
      id: 'approval',
      icon: ':carbon:stamp:',
      inputs: [{ handle: 'value', jsonSchema: {} }],
      kind: 'approval',
      label: t('addNode.approval'),
      outputs: [
        { handle: 'approve', jsonSchema: {} },
        { handle: 'reject', jsonSchema: {} },
      ],
    },
    {
      description: t('addNode.waitDescription'),
      group: t('addNode.humanInTheLoop'),
      id: 'wait',
      icon: ':carbon:hourglass:',
      inputs: [{ handle: 'value', jsonSchema: {} }],
      kind: 'wait',
      label: t('addNode.wait'),
      outputs: [{ handle: 'continue', jsonSchema: {} }],
    },
  ]
  const nodes = Object.values(revisionView(draft).graph()?.nodes ?? {})
  return triggers.filter(
    (option) =>
      !(option.kind == 'outputs' && nodes.some((node) => node.kind == 'outputs')) &&
      !nodes.some((node) =>
        node.kind == 'manual' || node.kind == 'start' ? option.id == 'trigger:start' : node.kind == 'error' && option.id == 'trigger:error',
      ),
  )
}

export function addNodeIntent(option: AddNodeOption, revision: RevisionView, t: TFunction): AddNodeIntent | undefined {
  switch (option.kind) {
    case 'workflow':
      return { kind: 'workflow', name: t('addNode.workflow') }
    case 'webhook-response':
      return { kind: 'webhook-response', name: t('addNode.webhookResponse') }
    case 'outputs':
      return { kind: 'outputs', name: t('addNode.outputs') }
    case 'new-task': {
      const name = t('addNode.codeTaskName', {
        number: Object.keys(revision.graph()!.nodes).length + 1,
      })
      return { kind: 'code', name }
    }
    case 'agent':
      return {
        kind: 'agent',
        name: t('addNode.agent'),
        prompt: t('agent.defaultPrompt', { input: '{{input}}' }),
        outputDescription: t('agent.defaultOutputDescription'),
      }
    case 'decision':
      return { kind: 'decision', name: t('addNode.decision') }
    case 'dedupe':
      return { kind: 'dedupe', name: t('flowState.nodeTitle') }
    case 'http-request':
      return { kind: 'http-request', name: t('httpRequest.title') }
    case 'openapi':
      return { kind: 'openapi', name: 'OpenAPI' }
    case 'llm': {
      const mode = option.id == 'llm:json' ? 'json' : 'chat'
      return {
        kind: 'llm',
        mode,
        name: t(mode == 'chat' ? 'addNode.llmChat' : 'addNode.llmStructured'),
        outputDescription: t('addNode.generatedResponse'),
      }
    }
    case 'connector':
      return { action: option.connector, kind: 'connector' }
    case 'connector-group':
      return
    case 'trigger': {
      if (!('trigger' in option) || option.trigger.kind == 'connect') return
      switch (option.trigger.kind) {
        case 'error':
          return { kind: 'error', name: t('errorWorkflow.trigger') }
        case 'start':
          return { kind: 'start', name: t('addNode.start') }
        case 'webhook':
          return { kind: 'webhook', name: t('addNode.webhook') }
        case 'cron':
          return { kind: 'cron', name: t('addNode.cron') }
        case 'catalog':
          return {
            connectionId: option.trigger.connectionId,
            definition: option.trigger.definition,
            kind: 'provider-trigger',
          }
      }
    }
    case 'comment':
      return
    case 'condition':
      return { kind: 'condition', name: t('addNode.condition') }
    case 'approval':
      return { kind: 'approval', name: t('addNode.approval') }
    case 'value':
      return { kind: 'value', name: t('addNode.value') }
    case 'wait':
      return { kind: 'wait', name: t('addNode.wait') }
  }
}
