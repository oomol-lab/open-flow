import styles from './JSONViewer.module.scss'
import type { JSX } from 'react/jsx-runtime'

import { isArray, isBoolean, isPlainObject, isString } from '@wopjs/cast'
import { cluster, isDate, isNumber } from 'radash'
import { useEffect, useRef } from 'react'
import { ReadMoreWeb } from 'react-shorten'
import { useTranslate } from 'val-i18n-react'
import { CompactValue } from './CompactValue.tsx'
import { useBool, useComponentId } from './hooks.ts'
import { getSpecialValueKind, SpecialValue } from './specialValue.tsx'

const SPECIAL_VALUE_REFERENCE = /^\${{([^:]+):([^}]+)}}$/

export interface JsonRenderProps<T = any> {
  field?: string | number
  value: T
  lastElement: boolean
  level: number
  shouldExpandNode: (level: number, value: any, field?: string | number) => boolean
  clickToExpandNode: boolean

  stringTruncateLength?: number
  /** Splits large collections into expandable groups. */
  groupSize?: number
  pseudoGroupIndex?: number
}

export interface ExpandableRenderProps {
  field?: string | number
  value: Array<any> | object
  data: Array<[string | number | undefined, any]>
  openBracket: string
  closeBracket: string
  lastElement: boolean
  level: number
  shouldExpandNode: (level: number, value: any, field?: string | number) => boolean
  clickToExpandNode: boolean

  stringTruncateLength?: number
  groupSize?: number
  pseudoGroupIndex?: number
}

function ExpandableObject({
  field,
  value,
  data,
  lastElement,
  openBracket,
  closeBracket,
  level,
  shouldExpandNode,
  clickToExpandNode,
  stringTruncateLength,
  groupSize,
  pseudoGroupIndex,
}: ExpandableRenderProps) {
  const shouldExpandNodeCalledRef = useRef(false)
  const [expanded, toggleExpanded, setExpanded] = useBool(() => pseudoGroupIndex == null && shouldExpandNode(level, value, field))

  useEffect(() => {
    if (!shouldExpandNodeCalledRef.current) {
      shouldExpandNodeCalledRef.current = true
    } else {
      setExpanded(shouldExpandNode(level, value, field))
    }
  }, [shouldExpandNode])

  const expanderIconStyle = expanded ? styles['collapse-icon'] : styles['expand-icon']
  const ariaLabel = expanded ? 'collapse JSON' : 'expand JSON'
  const contentsId = useComponentId()
  const childLevel = level + 1
  const lastIndex = data.length - 1

  return (
    <div className={styles['basic-element-style']} role="list">
      <button
        className={`${styles.inlineButton} ${expanderIconStyle}`}
        onClick={toggleExpanded}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={expanded}
        aria-controls={expanded ? contentsId : undefined}
      />
      {field != null &&
        (clickToExpandNode ? (
          <button
            aria-controls={expanded ? contentsId : undefined}
            aria-expanded={expanded}
            aria-label={ariaLabel}
            className={`${styles.inlineButton} ${isNumber(field) ? styles['clickable-index-label'] : styles['clickable-label']}`}
            onClick={toggleExpanded}
            tabIndex={-1}
            type="button"
          >
            {field}:
          </button>
        ) : (
          <span className={isNumber(field) ? styles['index-label'] : styles['label']}>{field}:</span>
        ))}
      {expanded ? (
        <>
          <button
            aria-controls={contentsId}
            aria-expanded
            aria-label={ariaLabel}
            className={`${styles.inlineButton} ${styles['bracket']}`}
            onClick={toggleExpanded}
            tabIndex={-1}
            type="button"
          >
            {openBracket}
          </button>
          {data.length > (groupSize || 0) && pseudoGroupIndex == null && (
            <span className={styles['item-count']}>
              {data.length} {data.length > 1 ? 'items' : 'item'}
            </span>
          )}
          <div id={contentsId}>
            {pseudoGroupIndex == null && groupSize != null && data.length > groupSize
              ? cluster(data, groupSize).map((group, index, groupArr) => (
                  <ExpandableObject
                    key={index}
                    value={group}
                    data={group}
                    lastElement={index === groupArr.length - 1}
                    level={childLevel}
                    openBracket={openBracket}
                    closeBracket={closeBracket}
                    shouldExpandNode={shouldExpandNode}
                    clickToExpandNode={clickToExpandNode}
                    stringTruncateLength={stringTruncateLength}
                    groupSize={groupSize}
                    pseudoGroupIndex={index}
                  />
                ))
              : data.map((dataElement, index) => (
                  <DataRender
                    key={dataElement[0] ?? index}
                    field={dataElement[0]}
                    value={dataElement[1]}
                    lastElement={index === lastIndex}
                    level={childLevel}
                    shouldExpandNode={shouldExpandNode}
                    clickToExpandNode={clickToExpandNode}
                    stringTruncateLength={stringTruncateLength}
                    groupSize={groupSize}
                  />
                ))}
          </div>
          <button
            aria-controls={contentsId}
            aria-expanded
            aria-label={ariaLabel}
            className={`${styles.inlineButton} ${styles['bracket']}`}
            onClick={toggleExpanded}
            tabIndex={-1}
            type="button"
          >
            {closeBracket}
          </button>
        </>
      ) : (
        <button
          className={`${styles.inlineButton} ${styles['collapsed-content']}`}
          onClick={toggleExpanded}
          tabIndex={-1}
          type="button"
          aria-label={ariaLabel}
          aria-expanded={expanded}
        >
          {pseudoGroupIndex != null && groupSize != null ? (
            `${groupSize * pseudoGroupIndex} ~ ${groupSize * pseudoGroupIndex + data.length - 1}`
          ) : (
            <CompactValue value={value} />
          )}
        </button>
      )}
      {!lastElement && pseudoGroupIndex == null && <span className={styles['punctuation']}>,</span>}
    </div>
  )
}

function JsonObject({
  field,
  value,
  lastElement,
  shouldExpandNode,
  clickToExpandNode,
  level,
  stringTruncateLength,
  groupSize,
  pseudoGroupIndex,
}: JsonRenderProps<{}>) {
  return ExpandableObject({
    field,
    value,
    lastElement: lastElement || false,
    level,
    openBracket: '{',
    closeBracket: '}',
    shouldExpandNode,
    clickToExpandNode,
    data: Object.entries(value),
    stringTruncateLength,
    groupSize,
    pseudoGroupIndex,
  })
}

function JsonArray({
  field,
  value,
  lastElement,
  level,
  shouldExpandNode,
  clickToExpandNode,
  stringTruncateLength,
  groupSize,
  pseudoGroupIndex,
}: JsonRenderProps<Array<any>>) {
  return ExpandableObject({
    field,
    value,
    lastElement: lastElement || false,
    level,
    openBracket: '[',
    closeBracket: ']',
    shouldExpandNode,
    clickToExpandNode,
    data: [...value.entries()],
    stringTruncateLength,
    groupSize,
    pseudoGroupIndex,
  })
}

function JsonPrimitiveValue({
  field,
  value,
  lastElement,
  stringTruncateLength,
}: JsonRenderProps<string | number | bigint | boolean | Date | null | undefined>) {
  const t = useTranslate()
  let stringValue: React.ReactNode
  let valueStyle = styles['value-other']

  if (value === null) {
    stringValue = 'null'
    valueStyle = styles['value-null']
  } else if (value === undefined) {
    stringValue = 'undefined'
    valueStyle = styles['value-undefined']
  } else if (isString(value)) {
    const result = SPECIAL_VALUE_REFERENCE.exec(value)
    if (result) {
      const [, type, internalValue] = result
      const internalType = getSpecialValueKind(type)
      stringValue = <SpecialValue type={internalType} value={internalValue} />
      valueStyle = `${styles['value-oo']} ${internalType}`
    } else {
      stringValue = (
        <ReadMoreWeb
          truncate={stringTruncateLength}
          showMoreText={t('jsonViewer.showMore')}
          showLessText={t('jsonViewer.showLess')}
          className={styles['read-more']}
        >
          "{value}"
        </ReadMoreWeb>
      )
      valueStyle = styles['value-string']
    }
  } else if (isBoolean(value)) {
    stringValue = value ? 'true' : 'false'
    valueStyle = styles['value-boolean']
  } else if (isNumber(value)) {
    stringValue = value.toString()
    valueStyle = styles['value-number']
  } else if (typeof value === 'bigint') {
    stringValue = `${value.toString()}n`
    valueStyle = styles['value-number']
  } else if (isDate(value)) {
    stringValue = value.toISOString()
  } else {
    stringValue = String(value)
  }

  if (field === '') {
    field = '""'
  }

  return (
    <div className={styles['basic-element-style']} role="listitem">
      {field != null && <span className={isNumber(field) ? styles['index-label'] : styles['label']}>{field}:</span>}
      <span className={valueStyle}>{stringValue}</span>
      {!lastElement && <span className={styles['punctuation']}>,</span>}
    </div>
  )
}

// Adapted from https://github.com/AnyRoad/react-json-view-lite/blob/release/src/DataRenderer.tsx.
export function DataRender(props: JsonRenderProps): JSX.Element {
  const value = props.value
  if (isArray(value)) {
    return <JsonArray {...props} />
  }

  if (isPlainObject(value) && !isDate(value)) {
    return <JsonObject {...props} />
  }

  return <JsonPrimitiveValue {...props} />
}
