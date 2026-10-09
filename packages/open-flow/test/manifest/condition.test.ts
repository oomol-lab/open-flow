import type { Revision } from '../../src/base/common/revision.ts'
import type { ConditionHandleDef, DefaultConditionHandleDef, HandleInputFrom, HandleName, InputHandleDef, NodeId } from '../../src/schema/index.ts'

import { describe, expect, it } from 'vitest'
import { WritableConditionNodeManifest } from '../../src/manifest/common/writable/node/writableConditionNodeManifest.ts'
import { WritableFlowManifest } from '../../src/manifest/common/writable/writableFlowManifest.ts'

const revision = 'revision-1' as Revision

function handle(name: string): HandleName {
  return name as HandleName
}

function nodeId(id: string): NodeId {
  return id as NodeId
}

const conditionSource = `title: Conditions
nodes:
  - node_id: gate
    title: Gate
    inputs_def:
      - handle: score
        json_schema:
          type: number
        schema_overrides:
          - path: format
            schema:
              type: string
    inputs_from:
      - handle: score
        schema_overrides:
          - schema:
              type: number
        from_node:
          - node_id: producer
            output_handle: result
    conditions:
      cases:
        - handle: pass
          logical: AND
          expressions:
            - input_handle: score
              operator: ">="
              value: 80
      default:
        handle: fail
`

describe('writable condition node', () => {
  it('parses nested condition definitions and round-trips field and handle changes', async () => {
    const manifest = new WritableFlowManifest(conditionSource, revision)
    const condition = WritableConditionNodeManifest.to(manifest.nodes.get(nodeId('gate')))

    expect(condition?.$.title.value).toBe('Gate')
    expect(condition?.$).not.toHaveProperty('timeout')
    expect(condition?.$).not.toHaveProperty('concurrency')
    expect(condition?.$.inputs_def.value).toEqual([
      {
        handle: 'score',
        json_schema: { type: 'number' },
        nullable: undefined,
        kind: undefined,
        schema_overrides: [{ path: 'format', schema: { type: 'string' } }],
      },
    ])
    expect(condition?.$.inputs_from.value).toEqual([
      {
        handle: 'score',
        value: undefined,
        schema_overrides: [{ schema: { type: 'number' } }],
        from_node: [{ node_id: 'producer', output_handle: 'result' }],
      },
    ])
    expect(condition?.$.conditions.value?.$.cases.value).toEqual([
      {
        handle: 'pass',
        description: undefined,
        logical: 'AND',
        expressions: [{ input_handle: 'score', operator: '>=', value: 80 }],
      },
    ])
    expect(condition?.$.conditions.value?.$.default.value).toEqual({ handle: 'fail', description: undefined })

    const inputDefs: InputHandleDef[] = [
      {
        handle: handle('score'),
        json_schema: { type: 'number' },
        schema_overrides: [{ path: ['payload', 0], schema: { type: 'string' } }],
      },
      { handle: handle('attempt'), json_schema: { type: 'integer' }, nullable: true },
    ]
    const inputsFrom: HandleInputFrom[] = [
      { handle: handle('score'), value: 95, schema_overrides: [{ 'schema': { type: 'number' }, 'ui:options': { selected: 1 } }] },
      { handle: handle('attempt'), value: 1 },
    ]
    const cases: ConditionHandleDef[] = [
      {
        handle: handle('pass'),
        description: 'Accepted',
        logical: 'AND',
        expressions: [
          { input_handle: handle('score'), operator: '>=', value: 90 },
          { input_handle: handle('attempt'), operator: '<', value: 3 },
        ],
      },
      {
        handle: handle('manual_review'),
        expressions: [{ input_handle: handle('score'), operator: '>=', value: 70 }],
      },
    ]
    const fallback: DefaultConditionHandleDef = { handle: handle('rejected'), description: 'Rejected' }

    expect(condition).toBeDefined()
    condition?.$$.title.set('Score gate')
    condition?.$$.progress_weight.set(2)
    condition?.$$.inputs_def.set(inputDefs)
    condition?.$$.inputs_from.set(inputsFrom)
    condition?.$$.conditions.value?.$$.cases.set(cases)
    condition?.$$.conditions.value?.$$.default.set(fallback)
    await Promise.resolve()

    const saved = manifest._toSaveFileString()
    const reparsed = new WritableFlowManifest(saved, revision)
    const reparsedCondition = WritableConditionNodeManifest.to(reparsed.nodes.get(nodeId('gate')))

    expect(reparsedCondition?.$.title.value).toBe('Score gate')
    expect(reparsedCondition?.$.progress_weight.value).toBe(2)
    expect(reparsedCondition?.$.inputs_def.value).toEqual(inputDefs)
    expect(reparsedCondition?.$.inputs_from.value).toEqual([
      {
        handle: 'score',
        value: 95,
        schema_overrides: [{ 'schema': { type: 'number' }, 'ui:options': { selected: 1 } }],
        from_node: undefined,
      },
      {
        handle: 'attempt',
        value: 1,
        schema_overrides: undefined,
        from_node: undefined,
      },
    ])
    expect(reparsedCondition?.$.conditions.value?.$.cases.value).toEqual(cases)
    expect(reparsedCondition?.$.conditions.value?.$.default.value).toEqual(fallback)
  })

  it('propagates nested changes until the owning manifest is disposed', async () => {
    const manifest = new WritableFlowManifest(conditionSource, revision)
    const condition = WritableConditionNodeManifest.to(manifest.nodes.get(nodeId('gate')))
    const conditions = condition?.$.conditions.value
    let changes = 0
    manifest.events.on('changed', () => {
      changes += 1
    })

    conditions?.$$.default.set({ handle: handle('otherwise') })
    await Promise.resolve()
    expect(changes).toBe(1)

    manifest.dispose()
    conditions?.$$.default.set({ handle: handle('after_dispose') })
    await Promise.resolve()
    expect(changes).toBe(1)
  })
})
