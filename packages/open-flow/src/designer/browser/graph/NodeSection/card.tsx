import styles from './card.module.scss'
import type { Val } from 'value-enhancer'

import { isDefined } from '@wopjs/cast'
import { clsx } from 'clsx'
import { useVal } from 'use-value-enhancer'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { stopPropagation } from '../../base/dom.ts'
import { isEmptyReactNode } from '../../base/react.ts'
import { asArray, filterString, toTrue } from '../../base/trivial.ts'
import { useNodeMiniMapPhase } from '../../components/minimap.tsx'
import { DesignerTooltip } from '../../components/tooltip.tsx'
import { NodeMiniMapPhase } from '../../stores/designer/nodeMiniMap.ts'

export interface ICardAction {
  readonly icon: string
  readonly title: string
  readonly count?: number
  readonly active?: boolean
  readonly disabled?: boolean
  readonly onClick: (ev: React.MouseEvent<HTMLButtonElement>) => void
}

export interface CardProps {
  readonly name?: string
  readonly className?: string
  readonly contentClassName?: string
  readonly prefix?: React.ReactNode
  readonly icon?: string
  readonly collapsedIcon?: string
  readonly title: React.ReactNode
  readonly titleSuffix?: React.ReactNode
  readonly help?: string
  readonly actions?: ICardAction | readonly ICardAction[]
  readonly suffix?: React.ReactNode
  readonly children?: React.ReactNode
  readonly collapsed$?: Val<boolean> | Val<boolean | undefined>
  readonly forceCollapsed?: boolean
  readonly onDrop?: (ev: React.DragEvent<HTMLDivElement>) => void
  readonly onDragEnd?: (ev: React.DragEvent<HTMLDivElement>) => void
  readonly onDragOver?: (ev: React.DragEvent<HTMLDivElement>) => void
  readonly onDragLeave?: (ev: React.DragEvent<HTMLDivElement>) => void
  readonly dragPosition?: number
}

export function NodeSectionActionButton({ action }: { readonly action: ICardAction }): React.ReactElement {
  return (
    <DesignerTooltip placement="top" title={action.title}>
      <Button
        aria-label={action.title}
        aria-pressed={action.active}
        className={styles.action}
        disabled={action.disabled}
        onClick={(event) => {
          stopPropagation(event)
          action.onClick(event)
        }}
        size="icon-xs"
        variant={action.active ? 'default' : 'ghost'}
      >
        <i className={action.icon} />
        {action.count != null && <Badge variant="secondary">{action.count}</Badge>}
      </Button>
    </DesignerTooltip>
  )
}

export function Card(props: CardProps): React.ReactElement {
  const storedCollapsed = useVal(props.collapsed$)
  const collapsed = props.forceCollapsed ?? storedCollapsed
  const nodeMiniMapPhase = useNodeMiniMapPhase()
  const isMinimap = toTrue(nodeMiniMapPhase !== NodeMiniMapPhase.None)

  const renderIcon = () => {
    let icon: string | undefined
    if (collapsed) {
      icon = filterString(props.collapsedIcon) || props.icon
    } else {
      icon = props.icon
    }
    return icon && <i className={icon} />
  }

  const title = (
    <>
      {renderIcon()}
      <span className={styles.title} title={filterString(props.title)}>
        {props.title}
        {props.titleSuffix}
      </span>
    </>
  )

  const header = (
    <h4 className={`${NODE_HANDLE_CLASSNAME} ${styles.header}`}>
      {props.prefix}
      {props.collapsed$ ? (
        <button aria-expanded={!collapsed} className={styles.headerToggle} onClick={() => props.collapsed$?.set(!collapsed)} type="button">
          {title}
        </button>
      ) : (
        title
      )}
      {props.help && (
        <DesignerTooltip placement="top" title={props.help}>
          <div className={styles.question}>
            <i className="i-codicon:question" />
          </div>
        </DesignerTooltip>
      )}
      {props.actions && asArray(props.actions).map((action) => <NodeSectionActionButton action={action} key={action.title} />)}
    </h4>
  )

  return (
    <div
      data-section={props.name}
      className={clsx(styles.wrapper, props.className)}
      onDragEnd={props.onDragEnd}
      onDrop={props.onDrop}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
    >
      {isDefined(props.dragPosition) && props.dragPosition < 0 && <div className={clsx(styles.dragIndicator, styles.dragIndicatorTop)} />}
      {isMinimap ? (
        <h4 className={styles.header}>{props.prefix}</h4>
      ) : props.suffix ? (
        <div className={styles.headerWrapper}>
          {header}
          {props.suffix}
        </div>
      ) : (
        header
      )}
      {!collapsed && !isEmptyReactNode(props.children) && <div className={clsx(styles.content, props.contentClassName)}>{props.children}</div>}
      {isDefined(props.dragPosition) && props.dragPosition > 0 && <div className={clsx(styles.dragIndicator, styles.dragIndicatorBottom)} />}
    </div>
  )
}
