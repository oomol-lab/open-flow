import type { TFunction } from 'val-i18n'
import type { FlowCanvasViewConditionCase, FlowCanvasViewConditionNode, FlowCanvasViewConditionOperand, FlowCanvasViewConditionOperator } from './model.ts'
import type { NodeContent } from './nodeContent.ts'

export function conditionOperandSummary(operand: FlowCanvasViewConditionOperand): string {
  return typeof operand == 'string' ? operand : operand.label
}

export function conditionOperatorSummary(operator: FlowCanvasViewConditionOperator, t: TFunction): string {
  switch (operator) {
    case 'is null':
      return '= null'
    case 'is not null':
      return '≠ null'
    case 'is true':
      return '= true'
    case 'is false':
      return '= false'
    default:
      return t(`condition.operator.${operator.replace(/\s+/g, '_')}`)
  }
}

export function conditionCaseHasExpressions(item: FlowCanvasViewConditionCase): boolean {
  return item.groups.some((group) => group.expressions.length > 0)
}

export function conditionGroupNeedsParentheses(item: FlowCanvasViewConditionCase, expressionCount: number): boolean {
  return item.groups.length > 1 && expressionCount > 1
}

export function conditionCaseSummary(item: FlowCanvasViewConditionCase, t: TFunction): string {
  if (item.groups.length === 0) return t('condition.emptyCase')
  return item.groups
    .map((group) => {
      const text = group.expressions
        .map((expression) => {
          const operator = conditionOperatorSummary(expression.operator, t)
          return `${conditionOperandSummary(expression.left)} ${operator}${expression.right === undefined ? '' : ` ${conditionOperandSummary(expression.right)}`}`
        })
        .join(' ∧ ')
      if (!text) return t('condition.emptyCase')
      return conditionGroupNeedsParentheses(item, group.expressions.length) ? `(${text})` : text
    })
    .join(' ∨ ')
}

export function conditionBranchSummary(node: Omit<FlowCanvasViewConditionNode, 'position'>, output: string, t: TFunction): string {
  const item = node.cases.find((candidate) => candidate.output == output)
  if (item != null) return (node.diagnostics ?? 0) > 0 || node.run?.status === 'error' ? t('condition.invalidCase') : conditionCaseSummary(item, t)
  return node.defaultOutput == output ? t('condition.default') : ''
}

export function nodeSummary(node: NodeContent): string {
  if (node.kind == 'condition') {
    return node.description?.trim() || ''
  }
  if (node.kind == 'approval' || node.kind == 'wait') return node.description?.trim() || node.notice?.text.trim() || ''
  return node.description?.trim() || ''
}

// Preview only recognizable image values; artifact identities are not download URLs.
export function imageSources(value: unknown): string[] {
  const result = new Set<string>()
  const visited = new WeakSet<object>()
  let remaining = 500
  const visit = (item: unknown, depth: number, image = false): void => {
    if (depth > 5 || result.size >= 8 || remaining-- <= 0) return
    if (item != null && typeof item == 'object') {
      if (visited.has(item)) return
      visited.add(item)
    }
    if (typeof item == 'string') {
      if (/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z\d+/=\s]+$/i.test(item)) result.add(item)
      else {
        try {
          const url = new URL(item)
          if ((url.protocol == 'https:' || url.protocol == 'http:') && (image || /\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname))) result.add(item)
        } catch {
          /* Non-URL output values have no image preview. */
        }
      }
    } else if (Array.isArray(item)) {
      item.slice(0, 50).forEach((entry) => visit(entry, depth + 1))
    } else if (item != null && typeof item == 'object') {
      const record = item as Record<string, unknown>
      const mediaType = record.mediaType ?? record.mimeType
      for (const [key, entry] of Object.entries(record).slice(0, 50)) {
        visit(entry, depth + 1, ['url', 'uri', 'src'].includes(key) && typeof mediaType == 'string' && /^image\/(png|jpeg|webp|gif|avif)$/.test(mediaType))
      }
    }
  }
  visit(value, 0)
  return [...result]
}

/** The same body projection owns both rendering and the collapse affordance. */
export function nodeCardContent(node: NodeContent) {
  const values = node.kind == 'value' ? node.values.filter((item) => item.value !== undefined) : []
  const summary = values.length > 0 ? '' : nodeSummary(node)
  const schedules = node.kind == 'trigger' ? node.presentation?.schedules : undefined
  const images = imageSources(node.run?.outputs)
  const tools = node.kind == 'task' ? node.tools : undefined
  const inline = node.kind == 'trigger' && !node.presentation?.source && !schedules?.length && !!summary && !summary.includes('\n') && summary.length <= 48
  const collapsible = node.kind != 'condition' && (values.length > 0 || !!schedules?.length || images.length > 0 || !!tools?.length || (!inline && !!summary))
  return { values, summary, schedules, images, tools, inline, collapsible, hidden: collapsible && node.contentHidden === true }
}
