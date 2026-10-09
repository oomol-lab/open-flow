import type { ConditionNode, JsonValue, Source } from '../../flow/common/change.ts'
import type { AuthoringConditionConfiguration, AuthoringConditionSource } from './authoringCondition.ts'

import { describe, expect, it } from 'vitest'
import { conditionOperands, selectConditionBranches } from '../../flow/common/condition.ts'
import { conditionConfigurationFieldPath, conditionConfigurationView, prepareConditionConfiguration } from './authoringCondition.ts'

const publicSource = (source: Source): AuthoringConditionSource => {
  if (source.kind == 'node') return { kind: 'output', node: source.nodeId, port: source.output, ...(source.field === undefined ? {} : { field: source.field }) }
  if (source.kind == 'binding') return { kind: 'variable', name: source.bindingId }
  throw new Error('Root conditions do not use Flow input sources.')
}
const internalSource = (source: AuthoringConditionSource): Source =>
  source.kind == 'variable'
    ? { kind: 'binding', bindingId: source.name }
    : { kind: 'node', nodeId: source.node, output: source.port ?? 'only', ...(source.field === undefined ? {} : { field: source.field }) }
const nodeFrom = (config: AuthoringConditionConfiguration): ConditionNode => ({
  kind: 'condition',
  name: 'Condition',
  inputs: {},
  ...prepareConditionConfiguration(config, internalSource),
})
const choose = (node: ConditionNode, amount: number, approved = false) => {
  const values: Record<string, JsonValue> = {}
  for (const { handle, operand } of conditionOperands(node)) {
    if (operand.kind == 'value') {
      if (operand.value !== undefined) values[handle] = operand.value
    } else values[handle] = operand.source.kind == 'node' ? amount : approved
  }
  return selectConditionBranches(node, values)
}
const config: AuthoringConditionConfiguration = {
  match: 'first',
  branches: [
    {
      name: 'priority',
      description: 'A high amount or explicit approval.',
      when: {
        any: [
          {
            all: [
              { left: { kind: 'output', node: 'orders', port: 'total' }, operator: '>=', right: { kind: 'value', value: 100, schema: { type: 'number' } } },
              { left: { kind: 'value', value: true }, operator: 'isTrue' },
            ],
          },
          { left: { kind: 'variable', name: 'approved' }, operator: 'isTrue' },
        ],
      },
    },
    { name: 'nonnegative', when: { left: { kind: 'output', node: 'orders', port: 'total' }, operator: '>=', right: { kind: 'value', value: 0 } } },
  ],
}

describe('Condition public configuration', () => {
  it('retains AND/OR behavior, branch order, first/all selection, and otherwise', () => {
    const first = nodeFrom(config)
    expect(choose(first, 100)).toEqual(['priority'])
    expect(choose(first, 99)).toEqual(['nonnegative'])
    expect(choose(first, -1, true)).toEqual(['priority'])
    expect(choose(first, -1)).toEqual(['otherwise'])
    expect(choose(nodeFrom({ ...config, match: 'all' }), 100)).toEqual(['priority', 'nonnegative'])
    expect(choose(nodeFrom({ ...config, branches: config.branches.toReversed() }), 100)).toEqual(['nonnegative'])
  })

  it('roundtrips persisted conditions without changing source contracts or optional metadata', () => {
    const node = nodeFrom(config)
    expect(conditionConfigurationView(node, publicSource)).toEqual(config)
    expect(prepareConditionConfiguration(conditionConfigurationView(node, publicSource), internalSource)).toEqual({
      cases: node.cases,
      matchMode: node.matchMode,
    })
  })

  it('normalizes a single group and expression without exposing structural wrappers', () => {
    const node = nodeFrom({
      match: 'all',
      branches: [{ name: 'only', when: { any: [{ all: [{ left: { kind: 'value', value: null }, operator: 'isNull' }] }] } }],
    })
    expect(conditionConfigurationView(node, publicSource).branches[0]?.when).toEqual({ left: { kind: 'value', value: null }, operator: 'isNull' })
    expect(choose(node, 0)).toEqual(['only'])
  })

  it.each([{ any: [] }, { all: [] }, { any: [{ all: [] }, { left: { kind: 'value' as const, value: true }, operator: 'isTrue' as const }] }])(
    'preserves invalid empty draft structure %j instead of inventing truth values',
    (when) => {
      const node = nodeFrom({ match: 'first', branches: [{ name: 'draft', when }] })
      const view = conditionConfigurationView(node, publicSource)
      expect(prepareConditionConfiguration(view, internalSource)).toEqual({ cases: node.cases, matchMode: node.matchMode })
      expect(() => choose(node, 0)).toThrow(/requires (a group|an expression)/)
    },
  )

  it('keeps missing values and unary unused right operands exactly for draft editing', () => {
    const node = nodeFrom({
      match: 'first',
      branches: [{ name: 'draft', when: { left: { kind: 'value', schema: { type: 'string' } }, operator: 'isNull', right: { kind: 'value', value: null } } }],
    })
    expect(prepareConditionConfiguration(conditionConfigurationView(node, publicSource), internalSource)).toEqual({
      cases: node.cases,
      matchMode: node.matchMode,
    })
    expect(() => choose(node, 0)).toThrow(/missing/)
  })

  it('delegates aliases, optional output selection and bindings to the owner callback', () => {
    const seen: AuthoringConditionSource[] = []
    const prepared = prepareConditionConfiguration(
      {
        match: 'first',
        branches: [{ name: 'bound', when: { left: { kind: 'output', node: '$new' }, operator: '==', right: { kind: 'variable', name: 'threshold' } } }],
      },
      (source) => {
        seen.push(source)
        return source.kind == 'output' ? { kind: 'node', nodeId: 'resolved', output: 'single' } : { kind: 'binding', bindingId: 'binding' }
      },
    )
    expect(seen).toEqual([
      { kind: 'output', node: '$new' },
      { kind: 'variable', name: 'threshold' },
    ])
    expect(prepared.cases[0]?.groups[0]?.expressions[0]?.left).toEqual({ kind: 'source', source: { kind: 'node', nodeId: 'resolved', output: 'single' } })
  })

  it('maps diagnostics through normalized groups and operands without rewriting schema keys', () => {
    const node = nodeFrom(config)
    expect(conditionConfigurationFieldPath(node, ['matchMode'])).toEqual(['match'])
    expect(conditionConfigurationFieldPath(node, ['cases', 0, 'output'])).toEqual(['branches', 0, 'name'])
    expect(conditionConfigurationFieldPath(node, ['cases', 0, 'groups', 0, 'expressions', 0, 'left', 'source', 'nodeId'])).toEqual([
      'branches',
      0,
      'when',
      'any',
      0,
      'all',
      0,
      'left',
      'node',
    ])
    expect(conditionConfigurationFieldPath(node, ['cases', 0, 'groups', 1, 'expressions', 0, 'left', 'source', 'bindingId'])).toEqual([
      'branches',
      0,
      'when',
      'any',
      1,
      'left',
      'name',
    ])
    expect(conditionConfigurationFieldPath(node, ['cases', 1, 'groups', 0, 'expressions', 0, 'right', 'jsonSchema', 'properties', 'output'])).toEqual([
      'branches',
      1,
      'when',
      'right',
      'schema',
      'properties',
      'output',
    ])
  })
})
