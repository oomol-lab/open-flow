import styles from './CanvasCard.module.scss'
import type { ReactNode } from 'react'

import { clsx } from 'clsx'
import { Children } from 'react'
import { isEmptyReactNode } from '../../../../../ui/browser/hooks.ts'

export function CanvasCard({
  title,
  icon,
  subtitle,
  children,
  preview,
  branches,
  footer,
  actions,
  problem,
  selected,
}: {
  readonly title: string
  readonly icon?: ReactNode
  readonly subtitle?: string
  readonly children?: ReactNode
  readonly preview?: ReactNode
  readonly branches?: ReactNode
  readonly footer?: ReactNode
  readonly actions?: ReactNode
  readonly problem?: string
  readonly selected?: boolean
}) {
  const hasContent = Children.toArray(children).some((child) => typeof child != 'string' || child.trim().length > 0)
  return (
    <article className={clsx(styles.card, selected && styles.selected, problem && styles.problem)}>
      <header className={styles.header}>
        <span className={styles.icon}>{icon}</span>
        <div className={styles.identity}>
          <strong title={title}>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {problem && (
          <span className={styles.warning} title={problem} aria-label={problem}>
            <i className="i-codicon:warning" />
          </span>
        )}
        {actions}
      </header>
      {hasContent && <div className={styles.content}>{children}</div>}
      {!isEmptyReactNode(preview) && <div className={styles.preview}>{preview}</div>}
      {!isEmptyReactNode(branches) && <div className={styles.branches}>{branches}</div>}
      {!isEmptyReactNode(footer) && <footer className={styles.footer}>{footer}</footer>}
    </article>
  )
}
