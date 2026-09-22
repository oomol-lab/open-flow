import type { GraphNode, ResolutionNode, TriggerNode } from '../../../../flow/common/change.ts'
import type { InputSourceCandidate } from '../../../../flow/common/graph.ts'

import { describe, expect, it } from 'vitest'
import { resolutionOutputPorts } from '../../../../flow/common/graph.ts'
import { uiLanguages } from '../../../../localization/common/languages.ts'
import { triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'
import { createI18n } from '../i18n.ts'
import {
  presentBuiltInOutputDescription,
  presentBuiltInSourceCandidates,
  presentBuiltInTriggerOutputs,
  presentResolutionOutputs,
} from './builtInOutputPresentation.ts'

const resolution = (kind: ResolutionNode['kind']): ResolutionNode => ({
  inputDefinitions: [],
  inputs: {},
  kind,
  prompt: 'Review this run.',
})

describe('built-in output presentation', () => {
  it.each(uiLanguages)('localizes scheduledAt for %s without adding copy to its runtime definition', (language) => {
    const trigger: TriggerNode = { kind: 'cron', name: 'Schedule', cronTimes: [] }
    const runtime = triggerOutputDefinitions(trigger)
    const presented = presentBuiltInTriggerOutputs(trigger, createI18n(language).t)

    expect(runtime[0]?.description).toBeUndefined()
    expect(presented[0]?.description).toBeTruthy()
    expect(presented[0]?.description).not.toBe('inspector.ports.builtIn.cron.scheduledAt')
  })

  it.each(uiLanguages)('localizes Webhook outputs for %s without adding copy to their runtime definitions', (language) => {
    const trigger: TriggerNode = { kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] }
    const runtime = triggerOutputDefinitions(trigger)
    const presented = presentBuiltInTriggerOutputs(trigger, createI18n(language).t)

    expect(runtime.every((port) => port.description == null)).toBe(true)
    expect(presented.map((port) => port.handle)).toEqual(['headers', 'query', 'body', 'webhookUrl'])
    expect(presented.every((port) => port.description != null && !port.description.startsWith('inspector.'))).toBe(true)
  })

  it('keeps body and its description out of GET Webhook outputs', () => {
    const trigger: TriggerNode = { kind: 'webhook', method: 'GET', name: 'Webhook', bodyFields: [] }
    const presented = presentBuiltInTriggerOutputs(trigger, createI18n('zh-CN').t)

    expect(presented.map((port) => port.handle)).toEqual(['headers', 'query', 'webhookUrl'])
    expect(presented.every((port) => port.description != null)).toBe(true)
  })

  it.each(['approval', 'wait'] as const)('reuses the canvas branch descriptions for %s outputs', (kind) => {
    const node = resolution(kind)
    const outputs = presentResolutionOutputs(node, createI18n('zh-CN').t)

    expect(Object.values(resolutionOutputPorts(node)).every((port) => port.description == null)).toBe(true)
    expect(outputs.map(({ handle, description }) => ({ handle, description }))).toEqual(
      kind === 'approval'
        ? [
            {
              handle: 'pending',
              description: '流程到达此节点后会立即生成审批链接并进入等待状态。访问链接完成审批后，流程继续。连接此端口可将链接发送到消息、邮件等渠道。',
            },
            { handle: 'approve', description: '审批结果为“通过”时触发。' },
            { handle: 'reject', description: '审批结果为“拒绝”时触发。' },
          ]
        : [
            {
              handle: 'pending',
              description: '流程到达此节点后会立即生成继续链接并进入等待状态。访问链接后，流程继续。连接此端口可将链接发送到消息、邮件等渠道。',
            },
            { handle: 'continue', description: '收到“继续”操作时触发。' },
          ],
    )
  })

  it.each(uiLanguages)('localizes built-in source descriptions for %s without changing graph candidates', (language) => {
    const t = createI18n(language).t
    const cases: readonly { readonly node: GraphNode; readonly output: string }[] = [
      { node: { kind: 'cron', name: 'Schedule', cronTimes: [] }, output: 'scheduledAt' },
      { node: { kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] }, output: 'body' },
      { node: resolution('wait'), output: 'pending' },
    ]
    for (const { node, output } of cases) {
      const candidates: readonly InputSourceCandidate[] = [{ output, check: { kind: 'available' } }]
      const presented = presentBuiltInSourceCandidates(node, candidates, t)
      expect(candidates[0]?.description).toBeUndefined()
      expect(presented[0]?.description).toBeTruthy()
      expect(presented[0]?.description).not.toContain('inspector.')
      expect(presentBuiltInOutputDescription(node, output, undefined, t)).toBe(presented[0]?.description)
    }
  })
})
