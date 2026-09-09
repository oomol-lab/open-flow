import styles from './JSONViewer.module.scss'

import { clsx } from 'clsx'
import { isDate, isNumber } from 'radash'

export interface CompactValueProps {
  readonly className?: string
  readonly maxDepth?: number
  readonly maxEntries?: number
  readonly maxStringLength?: number
  readonly value: unknown
}

interface CompactValuePartProps {
  readonly depth: number
  readonly maxDepth: number
  readonly maxEntries: number
  readonly maxStringLength: number
  readonly value: unknown
}

const identifierPattern = /^[A-Z_$][\w$]*$/i

function renderKey(key: string): string {
  return identifierPattern.test(key) ? key : JSON.stringify(key)
}

function CompactValuePart({ depth, maxDepth, maxEntries, maxStringLength, value }: CompactValuePartProps): React.ReactElement {
  if (value === null) return <span className={styles['value-null']}>null</span>
  if (value === undefined) return <span className={styles['value-undefined']}>undefined</span>
  if (typeof value == 'string') {
    const preview = value.length > maxStringLength ? `${value.slice(0, maxStringLength)}…` : value
    return <span className={styles['value-string']}>{JSON.stringify(preview)}</span>
  }
  if (typeof value == 'boolean') return <span className={styles['value-boolean']}>{value ? 'true' : 'false'}</span>
  if (isNumber(value) || typeof value == 'bigint') {
    return <span className={styles['value-number']}>{typeof value == 'bigint' ? `${value}n` : String(value)}</span>
  }
  if (isDate(value)) return <span className={styles['value-other']}>{value.toISOString()}</span>

  if (Array.isArray(value)) {
    const visibleValues = depth >= maxDepth ? [] : value.slice(0, maxEntries)
    return (
      <span className={styles['compact-collection']}>
        <span className={styles['bracket']}>[</span>
        {visibleValues.map((item, index) => (
          <span key={index}>
            {index > 0 && <span className={styles['compact-punctuation']}>, </span>}
            <CompactValuePart value={item} depth={depth + 1} maxDepth={maxDepth} maxEntries={maxEntries} maxStringLength={maxStringLength} />
          </span>
        ))}
        {(depth >= maxDepth || value.length > visibleValues.length) && (
          <span className={styles['compact-ellipsis']}>{visibleValues.length > 0 ? ', …' : '…'}</span>
        )}
        <span className={styles['bracket']}>]</span>
      </span>
    )
  }

  if (typeof value == 'object') {
    const entries = depth >= maxDepth ? [] : Object.entries(value).slice(0, maxEntries)
    const totalEntries = Object.keys(value).length
    return (
      <span className={styles['compact-collection']}>
        <span className={styles['bracket']}>{'{'}</span>
        {entries.map(([key, item], index) => (
          <span key={key}>
            {index > 0 && <span className={styles['compact-punctuation']}>, </span>}
            <span className={styles['compact-label']}>{renderKey(key)}: </span>
            <CompactValuePart value={item} depth={depth + 1} maxDepth={maxDepth} maxEntries={maxEntries} maxStringLength={maxStringLength} />
          </span>
        ))}
        {(depth >= maxDepth || totalEntries > entries.length) && <span className={styles['compact-ellipsis']}>{entries.length > 0 ? ', …' : '…'}</span>}
        <span className={styles['bracket']}>{'}'}</span>
      </span>
    )
  }

  return <span className={styles['value-other']}>{String(value)}</span>
}

export function CompactValue({ className, maxDepth = 1, maxEntries = 3, maxStringLength = 80, value }: CompactValueProps): React.ReactElement {
  return (
    <code className={clsx(styles['compact-value'], className)}>
      <CompactValuePart value={value} depth={0} maxDepth={maxDepth} maxEntries={maxEntries} maxStringLength={maxStringLength} />
    </code>
  )
}
