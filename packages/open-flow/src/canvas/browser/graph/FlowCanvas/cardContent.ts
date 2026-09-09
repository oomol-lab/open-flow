import type { TFunction } from 'val-i18n'
import type { FlowCanvasViewConditionCase, FlowCanvasViewConditionNode } from './model.ts'
import type { NodeContent } from './nodeContent.ts'

export function conditionCaseSummary(item: FlowCanvasViewConditionCase, t: TFunction): string {
  return item.expressions
    .map((expression) => {
      const operator = t(`condition.operator.${expression.operator.replace(/\s+/g, '_')}`)
      return `${expression.input} ${operator}${expression.value === undefined ? '' : ` ${JSON.stringify(expression.value)}`}`
    })
    .join(item.relation == 'all' ? ' ∧ ' : ' ∨ ')
}

export function conditionBranchSummary(node: Omit<FlowCanvasViewConditionNode, 'position'>, output: string, t: TFunction): string {
  const item = node.cases.find((candidate) => candidate.output == output)
  if (item != null) return conditionCaseSummary(item, t)
  return node.defaultOutput == output ? t('condition.default') : ''
}

export function nodeSummary(node: NodeContent, t: TFunction): string {
  if (node.kind == 'trigger') {
    const schedule = node.presentation?.schedules
      .map((item) =>
        item.type == 'cron' ? `${item.expression} · ${item.timezone}` : t('canvasCard.every', { value: item.value, unit: t(`canvasCard.units.${item.unit}`) }),
      )
      .join('\n')
    if (schedule) return schedule
    return node.description?.trim() || ''
  }
  if (node.kind == 'condition') {
    return node.description?.trim() || ''
  }
  if (node.kind == 'wait') return node.description?.trim() || node.notice?.text.trim() || ''
  if (node.kind == 'value') {
    return (
      node.values
        .filter((item) => item.value !== undefined)
        .slice(0, 4)
        .map((item) => {
          const value = typeof item.value == 'string' && item.value.trim() ? item.value : JSON.stringify(item.value)
          const text = value ?? ''
          return `${item.handle}: ${text.length > 100 ? `${text.slice(0, 100)}…` : text}`
        })
        .join('\n') ||
      node.description?.trim() ||
      ''
    )
  }
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
