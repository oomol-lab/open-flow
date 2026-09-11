import styles from './CanvasCard.module.scss'
import type { ReactNode } from 'react'

import { clsx } from 'clsx'
import { Children, useLayoutEffect, useRef, useState } from 'react'
import { isEmptyReactNode } from '../../../../../ui/browser/hooks.ts'

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
  selected,
  compact = false,
  compactContent = false,
  contentHidden = false,
  footerHidden = false,
}: {
  readonly compact?: boolean
  readonly compactContent?: boolean
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
  readonly selected?: boolean
}) {
  const hasContent = Children.toArray(children).some((child) => typeof child != 'string' || child.trim().length > 0)
  const hasBranches = !isEmptyReactNode(branches)
  const hasBody = (!contentHidden && (hasContent || !isEmptyReactNode(preview))) || hasBranches || (!footerHidden && !isEmptyReactNode(footer))
  const statusIndicator = problem && (
    <span className={clsx(styles.icon, styles.indicator, styles.warning)} title={problem} aria-label={problem} role="img">
      <i aria-hidden="true" className="i-lucide:triangle-alert" />
    </span>
  )
  return (
    <article
      className={clsx(
        styles.card,
        compact && styles.compact,
        compactContent && styles.compactContent,
        tone && styles[tone],
        selected && styles.selected,
        problem && styles.problem,
      )}
    >
      <header className={clsx(styles.header, hasBody && styles.withBody)}>
        <div className={styles.compactIdentity}>
          <span className={styles.icon}>{icon}</span>
          <strong title={title}>{title}</strong>
          {statusIndicator}
        </div>

        <span className={styles.icon}>{icon}</span>
        <div className={styles.identity}>
          <strong title={title}>{titleContent ?? title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {statusIndicator}
        {actions}
      </header>
      <div className={clsx(hasBody && !hasBranches && styles.singleContent)}>
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
      </div>
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
