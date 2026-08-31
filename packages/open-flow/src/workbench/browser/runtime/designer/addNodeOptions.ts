import type { TFunction } from 'val-i18n'
import type { ConnectorAction, Draft, JsonValue, TriggerKeySnapshot } from '../api.ts'
import type { RevisionView } from '../revisionView.ts'
import type { AddNodeIntent, DesignerTarget } from './flowChanges.ts'

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
  | { readonly kind: 'cron' }
  | { readonly kind: 'webhook' }

export type AddNodeOption = AddNodeOptionBase &
  (
    | { readonly kind: 'comment' }
    | { readonly kind: 'condition' }
    | { readonly connector: ConnectorAction; readonly kind: 'connector' }
    | {
        readonly choices: NonNullable<AddNodeOptionBase['choices']>
        readonly kind: 'connector-group'
        readonly serviceId: string
      }
    | { readonly kind: 'llm' }
    | { readonly kind: 'new-task' }
    | { readonly kind: 'subflow'; readonly referenceId: string }
    | {
        readonly choices: NonNullable<AddNodeOptionBase['choices']>
        readonly kind: 'trigger'
      }
    | { readonly kind: 'trigger'; readonly trigger: AddTrigger }
    | { readonly kind: 'value' }
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

function builtinOptions(t: TFunction): readonly AddNodeOption[] {
  const group = t('addNode.blocks')
  return [
    {
      description: t('addNode.javascriptDescription'),
      group,
      icon: ':carbon:code:',
      id: 'javascript',
      inputs: [{ handle: 'value', jsonSchema: {} }],
      kind: 'new-task',
      label: t('addNode.javascript'),
      outputs: [{ handle: 'result', jsonSchema: {} }],
    },
    {
      description: t('addNode.llmChatDescription'),
      group,
      id: 'llm:chat',
      icon: ':carbon:machine-learning-model:',
      inputs: [
        { handle: 'messages', jsonSchema: { type: 'array' } },
        { handle: 'input', jsonSchema: { type: 'string' } },
        { handle: 'template', jsonSchema: { type: 'array' } },
        { handle: 'model', jsonSchema: { type: 'object' } },
      ],
      kind: 'llm',
      label: t('addNode.llmChat'),
      outputs: [{ handle: 'output', jsonSchema: { type: 'string' } }],
    },
    {
      description: t('addNode.llmStructuredDescription'),
      group,
      id: 'llm:json',
      icon: ':carbon:machine-learning-model:',
      inputs: [
        { handle: 'messages', jsonSchema: { type: 'array' } },
        { handle: 'input', jsonSchema: { type: 'string' } },
        { handle: 'template', jsonSchema: { type: 'array' } },
        { handle: 'model', jsonSchema: { type: 'object' } },
      ],
      kind: 'llm',
      label: t('addNode.llmStructured'),
      outputs: [{ handle: 'output', jsonSchema: {} }],
    },
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

export function deriveAddNodeOptions(draft: Draft | undefined, target: DesignerTarget | undefined, t: TFunction): readonly AddNodeOption[] {
  if (draft == null || target == null) return []
  const options = builtinOptions(t)
  if (target.kind != 'flow') return options
  const group = t('addNode.triggers')
  return [
    {
      description: t('addNode.webhookDescription'),
      group,
      id: 'trigger:webhook',
      icon: ':carbon:webhook:',
      inputs: [],
      kind: 'trigger',
      label: t('addNode.webhook'),
      outputs: [{ handle: 'payload', jsonSchema: {} }],
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
      outputs: [
        {
          handle: 'payload',
          jsonSchema: { additionalProperties: false, type: 'object' },
        },
      ],
      trigger: { kind: 'cron' },
    },
    ...options,
  ]
}

export function addNodeIntent(option: AddNodeOption, revision: RevisionView, target: DesignerTarget, t: TFunction): AddNodeIntent | undefined {
  switch (option.kind) {
    case 'new-task': {
      const name = t('addNode.codeTaskName', {
        number: Object.keys(revision.graph(target)!.nodes).length + 1,
      })
      return { kind: 'code', name }
    }
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
    case 'value':
      return { kind: 'value', name: t('addNode.value') }
    case 'subflow':
      return { kind: 'subflow', subflowId: option.referenceId }
  }
}
