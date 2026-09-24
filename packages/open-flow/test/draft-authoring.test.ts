import { Validator } from '@cfworker/json-schema'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { expect, it } from 'vitest'
import { authoringExample, authoringExamples } from '../src/control/common/authoringExamples.ts'
import { decodeDraftOperations, draftOperationsSchema, resolveDraftOperations } from '../src/control/common/draftOperations.ts'
import { currentEngineContract, findEngineContract } from '../src/execution/common/runtime.ts'
import { applyFlowChanges, decodeChangeOperations } from '../src/flow/common/change.ts'
import { validateFlow } from '../src/flow/common/semantics.ts'
import { triggerDefinitions } from '../src/trigger/providers/definitions.ts'

const definitions = (key: string) => triggerDefinitions.find((definition) => definition.snapshot.key == key)!.snapshot

it.each(authoringExamples)('validates and applies the complete $name example', async ({ name }) => {
  const example = authoringExample(name)
  expect(new Validator(draftOperationsSchema() as object).validate(example.operations).valid).toBe(true)
  const decoded = decodeDraftOperations(example.operations)
  const operations = resolveDraftOperations(decoded, definitions)
  const content = applyFlowChanges(
    { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, tasks: {}, subflows: {}, graph: { nodes: {}, edges: [] } } },
    operations,
  )
  const checked = await validateFlow(content, findEngineContract(currentEngineContract)!)
  expect(checked.diagnostics).toEqual([])
  expect(checked.valid).toBe(true)
})

it('rejects invalid compact trigger requests in the schema and decoder', () => {
  const operation = authoringExample('poll').operations[0]!
  for (const candidate of [
    { ...operation, key: '' },
    { ...operation, schedule: [{ type: 'cron' }] },
    { ...operation, definition: {} },
  ]) {
    expect(() => decodeDraftOperations([candidate])).toThrow()
    expect(new Validator(draftOperationsSchema('graph.trigger.create') as object).validate(candidate).valid).toBe(false)
  }
})

it('rejects schedules on Integration triggers and allows an unselected account', () => {
  const operation = authoringExample('integration').operations[0]!
  expect(() => resolveDraftOperations(decodeDraftOperations([{ ...operation, schedule: [{ type: 'every', unit: 'minute', value: 1 }] }]), definitions)).toThrow(
    /Only Poll/,
  )
  const resolved = resolveDraftOperations(decodeDraftOperations([{ ...operation, connectionId: undefined }]), definitions)
  expect(resolved).toHaveLength(1)
  expect(resolved[0]).toMatchObject({ kind: 'graph.node.create', node: { kind: 'integration' } })
  expect(resolved[0]).not.toHaveProperty('node.connectionId')
})

it.each([
  { name: 'ordinary operation fields', candidate: { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'a' } }, path: 'edge.target:' },
  { name: 'trigger fields', candidate: { ...authoringExample('poll').operations[0]!, key: '' }, path: 'key:' },
  { name: 'unknown kind', candidate: { kind: 'unknown' }, path: 'Unknown operation "unknown".' },
  { name: 'missing kind', candidate: {}, path: 'kind:' },
  { name: 'invalid kind', candidate: { kind: 42 }, path: 'kind:' },
])('preserves batch indices for $name', ({ candidate, path }) => {
  const valid = { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'a', target: 'b' } }
  for (const index of [0, 1, 2]) {
    const batch = [...Array.from({ length: index }, () => valid), candidate]
    const draftBatch = batch.map((operation, position) => (index > 0 && position == 0 ? authoringExample('poll').operations[0]! : operation))
    expect(() => decodeDraftOperations(draftBatch)).toThrow(TypeError)
    expect(() => decodeDraftOperations(draftBatch)).toThrow(`operations[${index}]: ${path}`)
    if (candidate.kind != 'graph.trigger.create') expect(() => decodeChangeOperations(batch)).toThrow(`operations[${index}]: ${path}`)
  }
})
