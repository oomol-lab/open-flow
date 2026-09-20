import type {
  ConditionExpression,
  ConditionNode,
  ConditionOperand,
  ConditionOperator,
  GraphNode,
  InputMapping,
  InputPortDefinition,
  JsonValue,
  Source,
} from './change.ts'

import { dequal } from 'dequal/lite'

export const otherwiseOutput = 'otherwise'
export const conditionOperators: readonly ConditionOperator[] = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'hasKey',
  'notHasKey',
  'hasValue',
  'notHasValue',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
  'isTrue',
  'isFalse',
]
export const unaryOperator = (operator: ConditionOperator): boolean => operator.startsWith('is')
export const operandHandle = (caseIndex: number, groupIndex: number, expressionIndex: number, side: 'left' | 'right'): string =>
  `${caseIndex}/${groupIndex}/${expressionIndex}/${side}`

/** Derived addresses let operand bindings use the ordinary input analysis and editor. Never persisted as node inputs. */
export function conditionOperands(
  node: Pick<ConditionNode, 'cases'>,
): readonly { handle: string; operand: ConditionOperand; expression: ConditionExpression; side: 'left' | 'right' }[] {
  return node.cases.flatMap((item, c) =>
    item.groups.flatMap((group, g) =>
      group.expressions.flatMap((expression, e) => [
        { handle: operandHandle(c, g, e, 'left'), operand: expression.left, expression, side: 'left' as const },
        ...(!unaryOperator(expression.operator)
          ? [{ handle: operandHandle(c, g, e, 'right'), operand: expression.right ?? { kind: 'value' as const }, expression, side: 'right' as const }]
          : []),
      ]),
    ),
  )
}

export function nodeInputMappings(node: GraphNode): Readonly<Record<string, InputMapping>> {
  if (node.kind != 'condition') return 'inputs' in node ? node.inputs : {}
  return Object.fromEntries(
    conditionOperands(node).flatMap<[string, InputMapping]>(({ handle, operand }) =>
      operand.kind == 'source'
        ? [[handle, { kind: 'sources' as const, sources: [operand.source] }]]
        : operand.value === undefined
          ? []
          : [[handle, { kind: 'value' as const, value: operand.value }]],
    ),
  )
}

export function conditionInputPorts(node: ConditionNode): Readonly<Record<string, InputPortDefinition>> {
  return Object.fromEntries(
    conditionOperands(node).map(({ handle, operand }) => [
      handle,
      { jsonSchema: operand.kind === 'value' ? (operand.jsonSchema ?? {}) : {}, nullable: operand.kind === 'value' ? operand.value === null : true },
    ]),
  )
}

export function mapConditionSources(node: ConditionNode, map: (source: Source) => Source): ConditionNode {
  const operand = (value: ConditionOperand): ConditionOperand => (value.kind == 'source' ? { ...value, source: map(value.source) } : value)
  return {
    ...node,
    cases: node.cases.map((item) => ({
      ...item,
      groups: item.groups.map((group) => ({
        ...group,
        expressions: group.expressions.map((expression) => ({
          ...expression,
          left: operand(expression.left),
          ...(expression.right == null ? {} : { right: operand(expression.right) }),
        })),
      })),
    })),
  }
}

export function setConditionInput(node: ConditionNode, handle: string, mapping: InputMapping | undefined): ConditionNode {
  const entry = conditionOperands(node).find((item) => item.handle == handle)
  if (entry == null) throw new Error('Condition operand does not exist.')
  if (mapping?.kind == 'sources' && mapping.sources.length != 1) throw new Error('A Condition operand requires one Source.')
  const value: ConditionOperand =
    mapping?.kind == 'sources'
      ? { kind: 'source', source: mapping.sources[0]! }
      : {
          kind: 'value',
          ...(entry.operand.kind === 'value' && entry.operand.jsonSchema != null ? { jsonSchema: entry.operand.jsonSchema } : {}),
          ...(mapping?.kind == 'value' ? { value: mapping.value } : {}),
        }
  const [c, g, e] = handle.split('/').map(Number)
  return {
    ...node,
    cases: node.cases.map((item, ci) =>
      ci != c
        ? item
        : {
            ...item,
            groups: item.groups.map((group, gi) =>
              gi != g
                ? group
                : { ...group, expressions: group.expressions.map((expression, ei) => (ei != e ? expression : { ...expression, [entry.side]: value })) },
            ),
          },
    ),
  }
}

export function valueType(value: JsonValue): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}
export function operatorsForType(type?: string): readonly ConditionOperator[] {
  if (type == null) return conditionOperators
  const specific: Record<string, readonly ConditionOperator[]> = {
    number: ['<', '<=', '>', '>='],
    integer: ['<', '<=', '>', '>='],
    string: ['contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'],
    array: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
    object: ['hasKey', 'notHasKey', 'hasValue', 'notHasValue', 'isEmpty', 'isNotEmpty'],
    boolean: ['isTrue', 'isFalse'],
    null: [],
  }
  return ['==', '!=', ...(specific[type] ?? []), 'isNull', 'isNotNull']
}
const normalized = (type: string | undefined) => (type == 'integer' ? 'number' : type)

export interface ComparisonIssue {
  readonly target: 'operator' | 'right'
  readonly message: string
}

export function comparisonIssue(operator: ConditionOperator, leftType?: string, rightType?: string): ComparisonIssue | undefined {
  if (leftType != null && !operatorsForType(leftType).includes(operator)) {
    return { target: 'operator', message: `Operator ${operator} is not compatible with ${leftType}.` }
  }
  if (unaryOperator(operator) || rightType == null) return
  const required = ['<', '<=', '>', '>='].includes(operator)
    ? 'number'
    : ['startsWith', 'endsWith', 'hasKey', 'notHasKey'].includes(operator) || (['contains', 'notContains'].includes(operator) && leftType == 'string')
      ? 'string'
      : ['==', '!='].includes(operator)
        ? normalized(leftType)
        : undefined
  if (required != null && required != normalized(rightType)) {
    return { target: 'right', message: `Operator ${operator} requires a ${required} right operand.` }
  }
}
export function compareCondition(operator: ConditionOperator, left: JsonValue, right?: JsonValue): boolean {
  if (!unaryOperator(operator) && right === undefined) throw new Error('Condition right operand is missing.')
  const issue = comparisonIssue(operator, valueType(left), right === undefined ? undefined : valueType(right))
  if (issue != null) throw new Error(issue.message)
  switch (operator) {
    case '==':
      return dequal(left, right)
    case '!=':
      return !dequal(left, right)
    case '<':
      return (left as number) < (right as number)
    case '<=':
      return (left as number) <= (right as number)
    case '>':
      return (left as number) > (right as number)
    case '>=':
      return (left as number) >= (right as number)
    case 'contains':
    case 'notContains': {
      const contains = typeof left == 'string' ? left.includes(right as string) : (left as readonly JsonValue[]).some((item) => dequal(item, right))
      return operator == 'contains' ? contains : !contains
    }
    case 'startsWith':
      return (left as string).startsWith(right as string)
    case 'endsWith':
      return (left as string).endsWith(right as string)
    case 'hasKey':
    case 'notHasKey': {
      const has = Object.hasOwn(left as object, right as string)
      return operator == 'hasKey' ? has : !has
    }
    case 'hasValue':
    case 'notHasValue': {
      const has = Object.values(left as object).some((item) => dequal(item, right))
      return operator == 'hasValue' ? has : !has
    }
    case 'isEmpty':
    case 'isNotEmpty': {
      const empty = typeof left == 'string' || Array.isArray(left) ? left.length == 0 : Object.keys(left as object).length == 0
      return operator == 'isEmpty' ? empty : !empty
    }
    case 'isNull':
      return left === null
    case 'isNotNull':
      return left !== null
    case 'isTrue':
      return left === true
    case 'isFalse':
      return left === false
  }
}

export function selectConditionBranches(node: ConditionNode, values: Readonly<Record<string, JsonValue>>): readonly string[] {
  // Check every resolved operand before matching, including later cases in first mode.
  for (const { handle } of conditionOperands(node)) if (!Object.hasOwn(values, handle)) throw new Error(`Condition operand ${handle} is missing.`)
  const results = node.cases.map((item, c) => {
    if (item.groups.length == 0) throw new Error('Condition Case requires a group.')
    return item.groups.map((group, g) => {
      if (group.expressions.length == 0) throw new Error('Condition group requires an expression.')
      return group.expressions.map((expression, e) => {
        const left = values[operandHandle(c, g, e, 'left')]!
        const right = unaryOperator(expression.operator) ? undefined : values[operandHandle(c, g, e, 'right')]
        const issue = comparisonIssue(expression.operator, valueType(left), right === undefined ? undefined : valueType(right))
        if (issue != null || (!unaryOperator(expression.operator) && right === undefined))
          throw new Error(issue?.message ?? 'Condition right operand is missing.')
        return () => compareCondition(expression.operator, left, right)
      })
    })
  })
  const selected: string[] = []
  for (const [index, groups] of results.entries()) {
    if (!groups.some((expressions) => expressions.every((evaluate) => evaluate()))) continue
    selected.push(node.cases[index]!.output)
    if (node.matchMode == 'first') break
  }
  return selected.length == 0 ? [otherwiseOutput] : selected
}
