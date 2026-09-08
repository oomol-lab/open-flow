import styles from './handleRow.module.scss'

import { clsx } from 'clsx'
import { useId } from 'react'
import { HANDLE_ROW_CLASSNAME, HANDLE_ROW_EXPANDED_CLASSNAME } from '../base/designer.ts'
import { useHandleNoActions } from './handleNoActions.tsx'
import { NodeMiniMapPhase, useNodeMiniMapPhase } from './minimap.tsx'

export interface HandleRowProps {
  className?: string
  style?: React.CSSProperties
  variant?: 'default' | 'value-only'
  // All rows have a fixed `--widget-height` by default so the minimap can optimize rendering.
  // Set `resizeable` to allow controls such as textareas to resize vertically.
  resizable?: boolean

  // Slots.
  prefix?: React.ReactNode
  arrowPrefix?: React.ReactNode
  name?: React.ReactNode
  value?: React.ReactNode
  actions?: (IHandleAction | React.ReactNode)[] | React.ReactNode
  suffix?: React.ReactNode

  // The indentation and decorators of the row, starting from ''.
  // Example of a row with level 3 and has decorator at level 1: '|  '.
  level?: string
  // The last child of an expanded row should have no '|' decorator.
  isLast?: boolean

  // Use `null` to hide the arrow button.
  expanded?: boolean | null
  expandedDisabled?: boolean
  expandKey?: unknown
  onExpandedChange?: (expanded: boolean, key?: unknown) => void
  valueExpands?: boolean

  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

export interface IHandleAction {
  title: string
  icon: string | React.ReactNode
  disabled?: boolean
  onClick?: () => void
}

function isHandleAction(action: unknown): action is IHandleAction {
  return Boolean(action && Object.hasOwn(action, 'title') && Object.hasOwn(action, 'icon'))
}

function renderAction(action: unknown, index: number): React.ReactNode {
  if (isHandleAction(action)) {
    return (
      <button
        aria-label={action.title}
        key={index}
        className={styles.action}
        title={action.title}
        disabled={action.disabled}
        onClick={action.onClick}
        type="button"
      >
        {typeof action.icon === 'string' ? <i className={action.icon} /> : action.icon}
      </button>
    )
  }

  return (
    <span key={index} className={styles.action}>
      {action as any}
    </span>
  )
}

export function HandleRow(props: HandleRowProps): React.ReactElement {
  const expandLabelId = useId()
  const expandLabelInValue = props.variant === 'value-only' || props.name == null
  const nodeMiniMapPhase = useNodeMiniMapPhase()
  const isMiniMap = nodeMiniMapPhase !== NodeMiniMapPhase.None && !props.resizable
  const noActions = useHandleNoActions()
  const { level = '', isLast = true } = props

  const actions = Array.isArray(props.actions) ? props.actions.map(renderAction) : props.actions

  return (
    <div
      className={clsx(
        HANDLE_ROW_CLASSNAME,
        styles.wrapper,
        props.variant === 'value-only' && styles.valueOnly,
        isLast && styles.isLast,
        props.expanded != null && styles.hasArrow,
        props.expanded && HANDLE_ROW_EXPANDED_CLASSNAME,
        !props.resizable && styles.fixedHeight,
        props.className,
      )}
      data-level={level.length}
      style={props.style}
      onDragOver={props.onDragOver}
    >
      <div className={styles.name}>
        {props.prefix}
        {Array.from(level).map(function (decorator, i) {
          const d = i === level.length - 1 ? 2 : decorator === '|' ? 1 : 0
          return <div key={i} className={styles.level} data-decorator={d} />
        })}
        {isMiniMap ? (
          <div className={styles.arrowLevel} />
        ) : (
          <div className={styles.arrowLevel}>
            <div className={styles.arrowPrefix}>{props.arrowPrefix}</div>
            {props.valueExpands ? (
              <div aria-hidden className={`${styles.arrow} nodrag`} hidden={props.expanded == null}>
                {props.expanded ? <i className="i-carbon:chevron-down" /> : <i className="i-carbon:chevron-right" />}
              </div>
            ) : (
              <button
                aria-expanded={props.expanded ?? undefined}
                aria-labelledby={expandLabelId}
                className={`${styles.arrow} nodrag`}
                hidden={props.expanded == null}
                onClick={() => props.onExpandedChange?.(!props.expanded, props.expandKey)}
                disabled={props.expandedDisabled}
                type="button"
              >
                {props.expanded ? <i className="i-carbon:chevron-down" /> : <i className="i-carbon:chevron-right" />}
              </button>
            )}
          </div>
        )}
        <div className={styles.nameContent} id={expandLabelInValue ? undefined : expandLabelId}>
          {isMiniMap ? null : props.name}
        </div>
      </div>
      <div className={styles.value} id={expandLabelInValue ? expandLabelId : undefined}>
        {isMiniMap ? null : props.valueExpands ? (
          <button
            aria-expanded={props.expanded ?? undefined}
            className={styles.valueExpandTrigger}
            disabled={props.expandedDisabled}
            onClick={() => props.onExpandedChange?.(!props.expanded, props.expandKey)}
            type="button"
          >
            {props.value}
          </button>
        ) : (
          props.value
        )}
      </div>
      {noActions ? null : (
        <div className={`${styles.actions} nodrag`}>
          {isMiniMap ? null : actions}
          {props.suffix}
        </div>
      )}
    </div>
  )
}
