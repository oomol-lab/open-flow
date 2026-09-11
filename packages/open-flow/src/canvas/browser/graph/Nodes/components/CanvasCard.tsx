import styles from './CanvasCard.module.scss'
import type { ReactNode } from 'react'

import { clsx } from 'clsx'
import { Zap } from 'lucide-react'
import { Children, useLayoutEffect, useRef, useState } from 'react'
import { isEmptyReactNode } from '../../../../../ui/browser/hooks.ts'

export function TriggerIndicator({ label }: { readonly label: string }) {
  return (
    <span className={styles.triggerIndicator} role="img" aria-label={label}>
      <Zap aria-hidden="true" />
    </span>
  )
}

export function CanvasCard({
  title,
  tone,
  titleContent,
  icon,
  subtitle,
  children,
  preview,
  branches,
  footer,
  actions,
  problem,
  indicator,
  selected,
  compact = false,
  contentHidden = false,
  footerHidden = false,
}: {
  readonly compact?: boolean
  readonly contentHidden?: boolean
  readonly footerHidden?: boolean
  readonly tone?: 'comment' | 'value'
  readonly titleContent?: ReactNode
  readonly title: string
  readonly icon?: ReactNode
  readonly subtitle?: string
  readonly children?: ReactNode
  readonly preview?: ReactNode
  readonly branches?: ReactNode
  readonly footer?: ReactNode
  readonly actions?: ReactNode
  readonly problem?: string
  readonly indicator?: ReactNode
  readonly selected?: boolean
}) {
  const hasContent = Children.toArray(children).some((child) => typeof child != 'string' || child.trim().length > 0)
  const statusIndicator = (problem || indicator) && (
    <span className={clsx(styles.icon, styles.indicator, problem && styles.warning)} title={problem} aria-label={problem} role={problem ? 'img' : undefined}>
      {problem ? <i aria-hidden="true" className="i-lucide:triangle-alert" /> : indicator}
    </span>
  )
  return (
    <article className={clsx(styles.card, compact && styles.compact, tone && styles[tone], selected && styles.selected, problem && styles.problem)}>
      <div className={styles.compactIdentity}>
        <span className={styles.icon}>{icon}</span>
        <strong title={title}>{title}</strong>
        {statusIndicator}
      </div>
      <header className={styles.header}>
        <span className={styles.icon}>{icon}</span>
        <div className={styles.identity}>
          <strong title={title}>{titleContent ?? title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {statusIndicator}
        {actions}
      </header>
      {(hasContent || !isEmptyReactNode(preview)) && (
        <CardCollapse hidden={contentHidden}>
          {hasContent && <div className={styles.content}>{children}</div>}
          {!isEmptyReactNode(preview) && <div className={styles.preview}>{preview}</div>}
        </CardCollapse>
      )}
      {!isEmptyReactNode(branches) && <div className={styles.branches}>{branches}</div>}
      {!isEmptyReactNode(footer) && (
        <CardCollapse hidden={footerHidden}>
          <footer className={clsx(styles.footer, !contentHidden && !isEmptyReactNode(preview) && styles.afterPreview)}>{footer}</footer>
        </CardCollapse>
      )}
    </article>
  )
}

/** Retain content only while the closing transition needs it. */
export function CardCollapse({ hidden, children }: { readonly hidden: boolean; readonly children: ReactNode }) {
  const elementRef = useRef<HTMLDivElement>(null)
  const [present, setPresent] = useState(!hidden)

  useLayoutEffect(() => {
    const element = elementRef.current!
    element.toggleAttribute('inert', hidden)
    if (!hidden) {
      setPresent(true)
      return
    }

    // Flush the new grid size before reading its CSS transition. With reduced
    // motion (or no height change), there is no animation to wait for.
    element.getBoundingClientRect()
    const animations = element.getAnimations()
    let cancelled = false
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) setPresent(false)
    })
    return () => {
      cancelled = true
    }
  }, [hidden])

  return (
    <div className={styles.collapse} data-hidden={hidden} aria-hidden={hidden || undefined} ref={elementRef}>
      <div className={styles.collapseInner}>{(!hidden || present) && children}</div>
    </div>
  )
}
