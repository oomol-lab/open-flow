import type { Draft } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { expect, it } from 'vitest'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'
import { createI18n } from '../i18n.ts'
import { designerGraph } from '../workspace.ts'
import { deriveAddNodeOptions } from './addNodeOptions.ts'

function emptyDraft(): Draft {
  return {
    actorId: 'actor',
    createdAt: '2026-09-07T00:00:00.000Z',
    digest: 'digest',
    flowId: 'flow',
    modelVersion: currentFlowModelVersion,
    parentRevisionId: null,
    revisionId: 'revision',
    version: 1,
    content: {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        tasks: {},
        subflows: { nested: { graph: { edges: [], nodes: {} }, inputs: [], name: 'Nested', outputs: [] } },
        graph: { edges: [], nodes: {} },
      },
    },
  }
}

it('offers a manual trigger again after the existing one is removed', () => {
  const draft: Draft = {
    actorId: 'actor',
    createdAt: '2026-09-07T00:00:00.000Z',
    digest: 'digest',
    flowId: 'flow',
    modelVersion: currentFlowModelVersion,
    parentRevisionId: null,
    revisionId: 'revision',
    version: 1,
    content: {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } } },
    },
  }
  expect(designerGraph(draft, { kind: 'flow' }).nodes).toEqual([expect.objectContaining({ id: 'start', outputs: [] })])
  const t = createI18n('en').t
  const options = deriveAddNodeOptions(draft, { kind: 'flow' }, t)
  expect(options.find((option) => option.id == 'wait')).toMatchObject({ kind: 'wait', label: 'Wait', outputs: [{ handle: 'continue' }] })
  expect(options.find((option) => option.id == 'approval')).toMatchObject({
    kind: 'approval',
    label: 'Approval',
    outputs: [{ handle: 'approve' }, { handle: 'reject' }],
  })
  expect(options.some((option) => option.id == 'trigger:manual')).toBe(false)
  const webhook = options.find((option) => option.id == 'trigger:webhook')!
  expect(webhook.outputs).toEqual(triggerOutputDefinitions({ kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] }))
  expect(webhook.outputs.map((port) => port.handle)).toEqual(['headers', 'query', 'body', 'webhookUrl'])
  expect(webhook.outputs.map((port) => port.jsonSchema)).toEqual([
    { type: 'object', additionalProperties: { type: 'string' } },
    { type: 'object', additionalProperties: { type: ['string', 'array'], items: { type: 'string' } } },
    { type: 'object', properties: {}, required: [], additionalProperties: false },
    { type: 'string' },
  ])
  const cron = options.find((option) => option.id == 'trigger:cron')!
  expect(cron.outputs).toEqual(triggerOutputDefinitions({ kind: 'cron', name: 'Cron', cronTimes: [] }))
  expect(cron.outputs).toEqual([
    {
      handle: 'scheduledAt',
      jsonSchema: { type: 'string', format: 'date-time' },
      nullable: false,
    },
  ])
  const cleared: Draft = { ...draft, content: { ...draft.content, document: { ...draft.content.document, graph: { edges: [], nodes: {} } } } }
  expect(deriveAddNodeOptions(cleared, { kind: 'flow' }, t).find((option) => option.id == 'trigger:manual')).toMatchObject({ outputs: [] })
})

it('hides legacy LLM nodes from the node library', () => {
  const draft = emptyDraft()
  const t = createI18n('en').t

  for (const target of [{ kind: 'flow' } as const, { id: 'nested', kind: 'subflow' } as const]) {
    const options = deriveAddNodeOptions(draft, target, t)
    expect(options.some((option) => option.id == 'llm:chat' || option.id == 'llm:json')).toBe(false)
  }
})

it.each([
  ['en', 'JavaScript', 'Run JavaScript code in this node.', 'Describe the task. The AI Agent can use node inputs and the tools you add to complete it.'],
  ['zh-CN', 'JavaScript 脚本', '在此节点中运行 JavaScript 代码。', '描述要完成的任务。AI Agent 会使用节点输入和你添加的工具来完成。'],
  ['zh-TW', 'JavaScript 指令碼', '在此節點中執行 JavaScript 程式碼。', '描述要完成的任務。AI Agent 會使用節點輸入和你新增的工具來完成。'],
  [
    'ja',
    'JavaScript スクリプト',
    'このノードで JavaScript コードを実行します。',
    '実行したいタスクを説明してください。AI Agent はノードの入力と追加したツールを使ってタスクを完了します。',
  ],
  [
    'ko',
    'JavaScript 스크립트',
    '이 노드에서 JavaScript 코드를 실행합니다.',
    '완료하려는 작업을 설명하세요. AI Agent가 노드 입력과 추가한 도구를 사용해 작업을 수행합니다.',
  ],
  [
    'ru',
    'Скрипт JavaScript',
    'Выполнить код JavaScript в этом узле.',
    'Опишите задачу. AI Agent выполнит её, используя входные данные узла и добавленные вами инструменты.',
  ],
  [
    'fr',
    'Script JavaScript',
    'Exécuter du code JavaScript dans ce nœud.',
    'Décrivez la tâche à accomplir. L’AI Agent utilisera les entrées du nœud et les outils ajoutés pour la réaliser.',
  ],
] as const)('puts JavaScript and AI Agent first in the %s node library', (language, javascriptLabel, javascriptDescription, agentDescription) => {
  const options = deriveAddNodeOptions(emptyDraft(), { kind: 'flow' }, createI18n(language).t).filter((option) => option.kind != 'trigger')

  expect(options.slice(0, 2)).toMatchObject([
    { id: 'javascript', label: javascriptLabel, description: javascriptDescription },
    { id: 'agent', label: 'AI Agent', description: agentDescription },
  ])
})
