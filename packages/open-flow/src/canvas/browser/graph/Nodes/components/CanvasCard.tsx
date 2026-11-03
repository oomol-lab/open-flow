import styles from './CanvasCard.module.scss'
import type { ReactNode } from 'react'
import type { FlowCanvasViewNodeRun } from '../../FlowCanvas/model.ts'

import { clsx } from 'clsx'
import { Children, useLayoutEffect, useRef, useState } from 'react'
import { isEmptyReactNode } from '../../../../../ui/browser/hooks.ts'
import { CanvasTooltip } from '../../../components/tooltip.tsx'
import { hasRunRecords, RunChips, RunStatusIndicator } from './RunChips.tsx'

export interface CanvasCardDiagnostic {
  readonly message: string
  readonly icon?: ReactNode
  readonly tone?: 'danger' | 'warning'
}

// Normalize every card perimeter to the same units used by the CSS animation.
const runningBeamPathLength = 1000
const runningBeamLength = 160
const runningBeamLayerCount = 48
const runningBeamPeakOpacity = 0.9

// Nested strokes keep the fade on the path, including corners and the loop seam.
const runningBeamLayers = Array.from({ length: runningBeamLayerCount }, (_, index) => {
  const length = runningBeamLength * (1 - index / runningBeamLayerCount)
  const gap = (runningBeamPathLength - length) / 2
  const previousOpacity = runningBeamPeakOpacity * Math.sin((index / runningBeamLayerCount) * (Math.PI / 2)) ** 2
  const opacity = runningBeamPeakOpacity * Math.sin(((index + 1) / runningBeamLayerCount) * (Math.PI / 2)) ** 2
  return {
    dash: `0 ${gap} ${length} ${gap}`,
    // Alpha compositing: target = previous + layer * (1 - previous).
    opacity: (opacity - previousOpacity) / (1 - previousOpacity),
  }
})

export function CanvasCard({
  title,
  tone,
  titleContent,
  icon,
  subtitle,
  subtitleAccessory,
  children,
  preview,
  branches,
  actions,
  diagnostic,
  run,
  selected,
  running = run?.status === 'running',
  fill = false,
  compact = false,
  compactContent = false,
  contentHidden = false,
}: {
  readonly fill?: boolean
  readonly compact?: boolean
  readonly compactContent?: boolean
  readonly contentHidden?: boolean
  readonly tone?: 'comment' | 'value'
  readonly titleContent?: ReactNode
  readonly title: string
  readonly icon?: ReactNode
  readonly subtitle?: string
  readonly subtitleAccessory?: ReactNode
  readonly children?: ReactNode
  readonly preview?: ReactNode
  readonly branches?: ReactNode
  readonly actions?: ReactNode
  readonly diagnostic?: CanvasCardDiagnostic
  readonly run?: FlowCanvasViewNodeRun
  readonly selected?: boolean
  readonly running?: boolean
}) {
  const hasContent = Children.toArray(children).some((child) => typeof child != 'string' || child.trim().length > 0)
  const hasBranches = !isEmptyReactNode(branches)
  const runControls = hasRunRecords(run) ? <RunChips run={run} /> : undefined
  const hasBody = (!contentHidden && (hasContent || !isEmptyReactNode(preview))) || hasBranches
  const hasError = run?.status === 'error' || (diagnostic != null && diagnostic.tone !== 'warning')
  const diagnosticIndicator = diagnostic && (
    <CanvasTooltip title={diagnostic.message} placement="top">
      <span
        className={clsx(styles.icon, styles.indicator, diagnostic.tone === 'warning' ? styles.warning : styles.danger)}
        aria-label={diagnostic.message}
        role="img"
        tabIndex={0}
      >
        {diagnostic.icon ?? <i aria-hidden="true" className="i-lucide-light:triangle-alert" />}
      </span>
    </CanvasTooltip>
  )
  return (
    <article
      className={clsx(
        styles.card,
        fill && styles.fill,
        compact && styles.compact,
        compactContent && styles.compactContent,
        tone && styles[tone],
        selected && styles.selected,
        hasError && styles.problem,
      )}
    >
      <header className={clsx(styles.header, hasBody && styles.withBody)}>
        {compact && (
          <div className={styles.compactIdentity}>
            <span className={styles.icon}>{icon}</span>
            <strong title={title}>{title}</strong>
            {diagnosticIndicator ||
              (run && run.status !== 'idle' && (
                <span className={clsx(styles.icon, styles.indicator)}>
                  <RunStatusIndicator run={run} />
                </span>
              ))}
          </div>
        )}

        <span className={styles.icon}>{icon}</span>
        <div className={styles.identity}>
          <strong title={title}>{titleContent ?? title}</strong>
          {subtitle && (
            <span className={styles.subtitle}>
              <span>{subtitle}</span>
              {subtitleAccessory}
            </span>
          )}
        </div>
        {diagnosticIndicator || runControls}
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
      </div>
      {running && (
        <svg className={styles.runningBeam} aria-hidden="true">
          {runningBeamLayers.map((layer, index) => (
            <rect key={index} x="0.5" y="0.5" pathLength={runningBeamPathLength} strokeDasharray={layer.dash} strokeOpacity={layer.opacity} />
          ))}
        </svg>
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
