import type { Draft } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { expect, it } from 'vitest'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'
import { createI18n } from '../i18n.ts'
import { designerGraph } from '../workspace.ts'
import { deriveAddNodeOptions } from './addNodeOptions.ts'

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
  expect(webhook.outputs).toEqual(triggerOutputDefinitions({ kind: 'webhook', name: 'Webhook', bodyFields: [] }))
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
