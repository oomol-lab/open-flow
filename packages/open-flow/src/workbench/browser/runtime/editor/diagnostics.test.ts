import type { Diagnostic } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { deriveInspectorDiagnostics, diagnosticItems, diagnosticMessage } from './diagnostics.ts'

const base = {
  column: 0,
  line: 1,
  path: '/document/graph',
} as const

describe('Workbench Diagnostic messages', () => {
  it('resolves structured node references to user-facing titles', () => {
    const i18n = createI18n('zh-CN')
    const diagnostic: Diagnostic = {
      code: 'graph.node-output-incompatible',
      column: 0,
      line: 1,
      message: 'Upstream node "source" output "hits" is not compatible with this input.',
      mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'string', target: 'number' },
      path: '/document/graph/nodes/target/inputs/value',
      values: { nodeId: 'source', output: 'hits' },
    }

    expect(diagnosticMessage(diagnostic, i18n.t, (nodeId) => ({ source: 'Search records', target: 'Rank records' })[nodeId])).toBe(
      '“Search records hits”不能用于“Rank records value”：需要数字，但所选字段是字符串。',
    )
    i18n.dispose()
  })

  it('translates code variants with structured values', () => {
    const i18n = createI18n('zh-CN')
    const diagnostic: Diagnostic = {
      ...base,
      code: 'graph.target-missing',
      message: 'Task "missing" does not exist.',
      values: { taskId: 'missing', variant: 'task' },
    }

    expect(diagnosticMessage(diagnostic, i18n.t)).toBe('Task“missing”不存在。')
    i18n.dispose()
  })

  it('explains a missing trigger account without exposing its binding ID', () => {
    const i18n = createI18n('zh-CN')
    const diagnostic: Diagnostic = {
      ...base,
      code: 'trigger.connection-missing',
      message: 'Select a connection account for this Trigger.',
      values: { bindingId: 'internal-id' },
    }

    expect(diagnosticMessage(diagnostic, i18n.t)).toBe('请选择触发器的连接账号。')
    i18n.dispose()
  })

  it('does not expose trigger field handles without catalog labels', () => {
    const i18n = createI18n('zh-CN')
    const diagnostic: Diagnostic = {
      ...base,
      code: 'trigger.config-incomplete',
      message: 'Complete the required Trigger config fields: sourceId, eventTypes.',
      values: { fields: 'sourceId, eventTypes' },
    }

    expect(diagnosticMessage(diagnostic, i18n.t)).toBe('请完成触发器的必填配置。')
    i18n.dispose()
  })

  it('explains the Agent tool limit without hiding other configuration errors', () => {
    const i18n = createI18n('zh-CN')
    const diagnostic: Diagnostic = { ...base, code: 'agent.config-invalid', message: 'Declare at most 64 Agent tools.' }
    expect(diagnosticMessage(diagnostic, i18n.t)).toBe('Agent 最多可配置 64 个工具。')
    expect(diagnosticMessage({ ...diagnostic, message: 'Tool send requires a description.' }, i18n.t)).toBe('Tool send requires a description.')
    i18n.dispose()
  })

  it('uses the canonical message for an unknown code', () => {
    const i18n = createI18n('zh-CN')
    const diagnostic: Diagnostic = {
      ...base,
      code: 'plugin.custom',
      message: 'Plugin-specific problem.',
      values: { name: 'plugin' },
    }

    expect(diagnosticMessage(diagnostic, i18n.t)).toBe('Plugin-specific problem.')
    i18n.dispose()
  })

  it('locates a missing Trigger Connection in the account section', () => {
    const revision = revisionView({
      actorId: 'actor',
      content: {
        document: {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              trigger: {
                bindingId: 'binding',
                config: {},
                definition: {
                  configInputs: [],
                  definitionVersion: 2,
                  description: '',
                  displayName: 'Repository event',
                  endpoint: {
                    body: { allowArray: false, allowEmpty: false, formats: ['json'] },
                    methods: ['POST'],
                    successStatus: 200,
                  },
                  key: 'github.on_repo_event',
                  name: 'on_repo_event',
                  outputs: [{ handle: 'payload', jsonSchema: { additionalProperties: true, type: 'object' }, nullable: false }],
                  provider: 'github',
                  type: 'integration',
                },
                kind: 'integration',
                name: 'Repository event',
              },
            },
          },
          subflows: {},
          tasks: {},
        },
        modelVersion: currentFlowModelVersion,
        modules: {},
      },
      createdAt: '2026-08-31T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: currentFlowModelVersion,
      parentRevisionId: null,
      revisionId: 'revision',
      version: 1,
    })
    const diagnostic: Diagnostic = {
      ...base,
      code: 'trigger.connection-missing',
      message: 'Trigger Connection binding "binding" does not exist.',
      path: '/document/graph/nodes/trigger/bindingId',
      values: { bindingId: 'binding' },
    }
    const flowDiagnostic: Diagnostic = {
      ...base,
      code: 'graph.empty',
      message: 'The Flow graph is empty.',
    }
    const check = {
      closureDigest: 'closure',
      diagnostics: [diagnostic, flowDiagnostic],
      engineContract: 'open-flow-engine/v5',
      flowId: 'flow',
      modelVersion: currentFlowModelVersion,
      revisionDigest: 'digest',
      revisionId: 'revision',
      valid: false,
      version: 1 as const,
    }
    expect(deriveInspectorDiagnostics(revision, { kind: 'flow' }, { ...check, revisionId: 'previous' }, undefined)).toEqual([])

    expect(diagnosticItems(revision, { kind: 'flow' }, check)).toMatchObject([{ location: { nodeId: 'trigger', section: 'account' } }, { location: undefined }])
    expect(deriveInspectorDiagnostics(revision, { kind: 'flow' }, check, undefined)).toEqual([flowDiagnostic])
    expect(deriveInspectorDiagnostics(revision, { kind: 'flow' }, check, revision.selection({ kind: 'flow' }, 'trigger'))).toEqual([diagnostic])
  })
})
