import type { DiagnosticItem } from './diagnostics.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { expect, it } from 'vitest'
import { airtableRecordChanged } from '../../../../trigger/providers/airtable/on-record-changed.ts'
import { feishuEvents } from '../../../../trigger/providers/feishu/on-event.ts'
import { githubRepoEvent } from '../../../../trigger/providers/github/on-repo-event.ts'
import { localizeTrigger } from '../../../../trigger/providers/localization.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { presentTriggerDiagnostics } from './triggerDiagnosticPresentation.ts'

const target = { kind: 'flow' } as const
const revision = revisionView({
  actorId: 'actor',
  content: {
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          feishu: { kind: 'integration', name: 'Application Event', bindingId: 'binding', config: {}, definition: feishuEvents[0]!.snapshot },
          github: { kind: 'integration', name: 'Repository Event', bindingId: 'binding', config: {}, definition: githubRepoEvent.snapshot },
          airtable: { kind: 'poll', name: 'Record Changed', bindingId: 'binding', config: {}, definition: airtableRecordChanged.snapshot, pollTimes: [] },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: currentFlowModelVersion,
    modules: {},
  },
  createdAt: '2026-09-23T00:00:00.000Z',
  digest: 'digest',
  flowId: 'flow',
  modelVersion: currentFlowModelVersion,
  parentRevisionId: null,
  revisionId: 'revision',
  version: 1,
})

function item(nodeId: string, fields: readonly string[]): DiagnosticItem {
  return {
    diagnostic: {
      code: 'trigger.config-incomplete',
      column: 0,
      fields,
      line: 1,
      message: `Complete the required Trigger config fields: ${fields.join(', ')}.`,
      path: `/document/graph/nodes/${nodeId}/config`,
      values: { fields: fields.join(', ') },
    },
    location: { nodeId, section: 'node' },
    scope: 'node',
  }
}

it('uses catalog field labels for different Trigger providers and hides unknown handles', async () => {
  const i18n = createI18n('zh-CN')
  const definitions = [feishuEvents[0]!.snapshot, githubRepoEvent.snapshot, airtableRecordChanged.snapshot]
  const displays = Object.fromEntries(await Promise.all(definitions.map(async (definition) => [definition.key, await localizeTrigger(definition, 'zh-CN')])))
  const items = [
    item('feishu', ['sourceId', 'eventTypes']),
    item('github', ['events', 'owner', 'repo']),
    item('airtable', ['baseId', 'tableIdOrName', 'triggerField']),
    item('github', ['externalField']),
  ]

  expect(presentTriggerDiagnostics(items, revision, target, displays, 'zh-CN', i18n.t).map((entry) => entry.message)).toEqual([
    '请完成触发器的必填配置：事件源和接收的事件。',
    '请完成触发器的必填配置：事件、仓库所有者和仓库。',
    '请完成触发器的必填配置：Base、数据表和触发字段。',
    '请完成触发器的必填配置。',
  ])
  i18n.dispose()
})
