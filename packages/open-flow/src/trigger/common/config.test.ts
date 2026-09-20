import type { Group, InputPort, RevisionContent } from '../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../flow/common/changeSchema.ts'
import { encodeRevision, decodeRevision } from '../../flow/common/encoding.ts'
import { triggerDefinitions } from '../providers/definitions.ts'
import { configInputsSchema, missingTriggerConfig, resolveTriggerConfig } from './config.ts'
import { validateTriggerDefinitionSchemas } from './definition.ts'

const inputs: readonly (InputPort | Group)[] = [
  { handle: 'name', nullable: false, jsonSchema: { type: 'string' }, value: 'default' },
  { group: 'Options', collapsed: true },
  { handle: 'note', nullable: true, jsonSchema: { type: 'string' } },
  { handle: 'tags', nullable: false, jsonSchema: { type: 'array', items: { type: 'string' } }, value: [] },
  { handle: 'enabled', nullable: false, jsonSchema: { type: 'boolean' }, value: false },
]

describe('fixed trigger inputs', () => {
  it('resolves defaults and nullable inputs without modifying saved configuration', () => {
    const config = {}
    expect(resolveTriggerConfig(inputs, config)).toEqual({ name: 'default', note: null, tags: [], enabled: false })
    expect(config).toEqual({})
    expect(missingTriggerConfig(inputs, config)).toEqual([])
    expect(resolveTriggerConfig(inputs, JSON.parse(JSON.stringify({ name: '', note: null, tags: [] })))).toEqual({
      name: '',
      note: null,
      tags: [],
      enabled: false,
    })
  })

  it('preserves explicit null, rejects invalid values and restores defaults after clearing', () => {
    const nullable = [{ handle: 'name', nullable: true, jsonSchema: { type: 'string' }, value: 'default' }] as const
    expect(resolveTriggerConfig(nullable, { name: null })).toEqual({ name: null })
    expect(resolveTriggerConfig(nullable, {})).toEqual({ name: 'default' })
    expect(() => resolveTriggerConfig(inputs, { name: null })).toThrow('name')
    expect(() => resolveTriggerConfig(inputs, { enabled: 'false' })).toThrow('enabled')
    expect(() => resolveTriggerConfig(inputs, { unknown: true })).toThrow('Unknown')
    const required = [{ handle: 'id', nullable: false, jsonSchema: { type: 'string', minLength: 1 } }] as const
    expect(missingTriggerConfig(required, {})).toEqual(['id'])
    expect(() => resolveTriggerConfig(required, {})).toThrow('id')
    expect(() => resolveTriggerConfig(required, { id: '' })).toThrow('id')
  })

  it('round-trips input groups, defaults, nulls and the fixed output definitions', () => {
    const definition = triggerDefinitions.find(({ snapshot }) => snapshot.key === 'slack.on_message_posted')!.snapshot
    if (definition.type !== 'poll') throw new Error('Expected Poll fixture')
    const revision: RevisionContent = {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        tasks: {},
        subflows: {},
        graph: {
          edges: [],
          nodes: {
            trigger: {
              kind: 'poll' as const,
              name: 'Trigger',
              bindingId: 'connection',
              pollTimes: [],
              definition: { ...definition, configInputs: inputs },
              config: { name: '', note: null },
            },
          },
        },
      },
    }
    expect(decodeRevision(encodeRevision(revision))).toEqual(revision)
  })

  it('rejects duplicate handles, invalid defaults and excessive resolved values', () => {
    const field = { handle: 'id', nullable: false, jsonSchema: { type: 'string' }, value: 'ok' }
    expect(() => resolveTriggerConfig([field, field], {})).toThrow('duplicate')
    expect(() => validateTriggerDefinitionSchemas({ configInputs: [{ ...field, value: 1 }], outputs: [] })).toThrow('id')
    expect(() => resolveTriggerConfig([field], { id: 'x'.repeat(65536) })).toThrow('limit')
  })

  it.each(triggerDefinitions)('accepts the complete $snapshot.key input and output definitions', ({ snapshot }) => {
    expect(configInputsSchema.parse(snapshot.configInputs)).toEqual(snapshot.configInputs)
    expect(() => validateTriggerDefinitionSchemas(snapshot)).not.toThrow()
    expect(snapshot.outputs.some((port) => port.handle === 'payload')).toBe(false)
  })
})
