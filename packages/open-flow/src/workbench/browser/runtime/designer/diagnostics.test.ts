import type { Diagnostic } from '../api.ts'

import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { diagnosticItems, diagnosticMessage } from './diagnostics.ts'

const base = {
  column: 0,
  line: 1,
  path: '/document/graph',
} as const

describe('Workbench Diagnostic messages', () => {
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
            nodes: {
              trigger: {
                bindingId: 'binding',
                config: {},
                definition: {
                  configSchema: { additionalProperties: false, type: 'object' },
                  definitionVersion: 1,
                  description: '',
                  displayName: 'Repository event',
                  endpoint: {
                    body: { allowArray: false, allowEmpty: false, formats: ['json'] },
                    methods: ['POST'],
                    successStatus: 200,
                  },
                  key: 'github.on_repo_event',
                  name: 'on_repo_event',
                  payloadSchema: { additionalProperties: true, type: 'object' },
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
        modelVersion: 1,
        modules: {},
      },
      createdAt: '2026-08-31T00:00:00.000Z',
      digest: 'digest',
      flowId: 'flow',
      modelVersion: 1,
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

    expect(
      diagnosticItems(
        revision,
        { kind: 'flow' },
        {
          closureDigest: 'closure',
          diagnostics: [diagnostic],
          engineContract: 'open-flow-engine/v1',
          flowId: 'flow',
          modelVersion: 1,
          revisionDigest: 'digest',
          revisionId: 'revision',
          valid: false,
          version: 1,
        },
      ),
    ).toMatchObject([{ location: { nodeId: 'trigger', section: 'account' } }])
  })
})
