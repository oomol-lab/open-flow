import type { ConditionExpression, ConditionNode, ConditionOperand, ConditionOperator, JsonValue, Source } from '../../flow/common/change.ts'

export type AuthoringConditionSource =
  | { readonly kind: 'output'; readonly node: string; readonly port?: string; readonly field?: string }
  | { readonly kind: 'variable'; readonly name: string }
export type AuthoringConditionOperand = AuthoringConditionSource | { readonly kind: 'value'; readonly value?: JsonValue; readonly schema?: JsonValue }
export interface AuthoringConditionExpression {
  readonly left: AuthoringConditionOperand
  readonly operator: ConditionOperator
  readonly right?: AuthoringConditionOperand
}
type All = { readonly all: readonly AuthoringConditionExpression[] }
export type AuthoringConditionWhen = AuthoringConditionExpression | All | { readonly any: readonly (AuthoringConditionExpression | All)[] }
export interface AuthoringConditionConfiguration {
  readonly match: ConditionNode['matchMode']
  readonly branches: readonly { readonly name: string; readonly description?: string; readonly when: AuthoringConditionWhen }[]
}

/** Preserve empty groups in invalid drafts; do not turn them into unconditional branches. */
export function conditionConfigurationView(
  node: Pick<ConditionNode, 'cases' | 'matchMode'>,
  source: (value: Source) => AuthoringConditionSource,
): AuthoringConditionConfiguration {
  const operand = (value: ConditionOperand): AuthoringConditionOperand =>
    value.kind == 'source'
      ? source(value.source)
      : { kind: 'value', ...(value.value === undefined ? {} : { value: value.value }), ...(value.jsonSchema === undefined ? {} : { schema: value.jsonSchema }) }
  const expression = (value: ConditionExpression): AuthoringConditionExpression => ({
    left: operand(value.left),
    operator: value.operator,
    ...(value.right === undefined ? {} : { right: operand(value.right) }),
  })
  return {
    match: node.matchMode,
    branches: node.cases.map((branch) => {
      const groups = branch.groups.map((group) =>
        group.expressions.length == 1 ? expression(group.expressions[0]!) : { all: group.expressions.map(expression) },
      )
      return {
        name: branch.output,
        ...(branch.description === undefined ? {} : { description: branch.description }),
        when: groups.length == 1 ? groups[0]! : { any: groups },
      }
    }),
  }
}

export function prepareConditionConfiguration(
  config: AuthoringConditionConfiguration,
  source: (value: AuthoringConditionSource) => Source,
): Pick<ConditionNode, 'cases' | 'matchMode'> {
  const operand = (value: AuthoringConditionOperand): ConditionOperand =>
    value.kind == 'value'
      ? { kind: 'value', ...(value.value === undefined ? {} : { value: value.value }), ...(value.schema === undefined ? {} : { jsonSchema: value.schema }) }
      : { kind: 'source', source: source(value) }
  const expression = (value: AuthoringConditionExpression): ConditionExpression => ({
    left: operand(value.left),
    operator: value.operator,
    ...(value.right === undefined ? {} : { right: operand(value.right) }),
  })
  return {
    matchMode: config.match,
    cases: config.branches.map((branch) => {
      const groups = 'any' in branch.when ? branch.when.any : [branch.when]
      return {
        output: branch.name,
        ...(branch.description === undefined ? {} : { description: branch.description }),
        groups: groups.map((group) => ({ expressions: ('all' in group ? group.all : [group]).map(expression) })),
      }
    }),
  }
}

/** Map a path relative to a persisted Condition configuration into its normalized public config. */
export function conditionConfigurationFieldPath(node: Pick<ConditionNode, 'cases'>, path: readonly (string | number)[]): readonly (string | number)[] {
  if (path[0] == 'matchMode') return ['match', ...path.slice(1)]
  if (path[0] != 'cases') return path
  if (path.length == 1) return ['branches']
  const branchIndex = Number(path[1]),
    branch = node.cases[branchIndex],
    base: (string | number)[] = ['branches', path[1]!]
  if (path[2] == 'output') return [...base, 'name', ...path.slice(3)]
  if (path[2] != 'groups') return [...base, ...path.slice(2)]
  base.push('when')
  if (branch == null || path.length == 3) return base
  const groupIndex = Number(path[3]),
    group = branch.groups[groupIndex]
  if (branch.groups.length != 1) base.push('any', path[3]!)
  if (path[4] != 'expressions') return [...base, ...path.slice(4)]
  if (group == null || path.length == 5) return group?.expressions.length == 1 ? base : [...base, 'all']
  if (group.expressions.length != 1) base.push('all', path[5]!)
  const remaining = path.slice(6).filter((part, index) => !(index == 1 && part == 'source'))
  if (remaining[0] == 'left' || remaining[0] == 'right') {
    switch (remaining[1]) {
      case 'jsonSchema':
        remaining[1] = 'schema'
        break
      case 'nodeId':
        remaining[1] = 'node'
        break
      case 'output':
        remaining[1] = 'port'
        break
      case 'bindingId':
        remaining[1] = 'name'
        break
    }
  }
  return [...base, ...remaining]
}
