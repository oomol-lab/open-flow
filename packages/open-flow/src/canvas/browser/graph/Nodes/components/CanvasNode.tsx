import styles from './CanvasNode.module.scss'
import type { ReactNode } from 'react'
import type { NodeStore } from '../../../stores/node/node.store.ts'

import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { cronDescription, cronLabel } from '../../../../../trigger/browser/cronDescription.ts'
import { timeZoneLabel } from '../../../../../trigger/browser/timeZones.ts'
import { IconStack } from '../../../../../ui/browser/icon-stack.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../../base/canvas.ts'
import { CanvasTooltip } from '../../../components/tooltip.tsx'
import { nodeCardContent } from '../../FlowCanvas/cardContent.ts'
import { CanvasCard } from './CanvasCard.tsx'
import { CanvasNodeIcon } from './CanvasNodeIcon.tsx'
import { NodeContentRows } from './NodeContentRows.tsx'
import { RunChips, ImagePreview } from './RunChips.tsx'
import { ValuePreview } from './ValuePreview.tsx'

export function CanvasNode({
  nodeStore,
  problem,
  branches,
  compact = false,
  compactContent = false,
}: {
  readonly nodeStore: NodeStore
  readonly problem?: string
  readonly branches?: ReactNode
  readonly compact?: boolean
  readonly compactContent?: boolean
}) {
  const t = useTranslate()
  const language = useLang()
  const selected = useVal(nodeStore.$.selected)
  const node = useVal(nodeStore.content$)
  const actions = node.kind === 'task' ? node.actionSummary : undefined
  const actionLabel = actions == null ? undefined : t('canvasCard.actionSummary', { actions: actions.count, providers: actions.providers.length })
  const title = node.title
  const { values, summary, schedules, images, inline, hidden } = nodeCardContent(node)
  const kind = node?.kind ?? 'task'
  const triggerSource =
    node.kind == 'trigger'
      ? node.presentation?.kind == 'manual' || node.presentation?.kind == 'cron' || node.presentation?.kind == 'webhook'
        ? t(`canvasCard.triggerSource.${node.presentation.kind}`)
        : node.presentation?.source
      : undefined
  const subtitle = inline
    ? summary
    : node.kind == 'task'
      ? node.executorName || t('canvasCard.kind.task')
      : node.kind == 'trigger' && triggerSource
        ? `${t('canvasCard.kind.trigger')} · ${triggerSource}`
        : t(`canvasCard.kind.${kind}`)
  const runContent = node?.run == null || node.run.status == 'idle' ? undefined : <RunChips run={node.run} />
  return (
    <div className={NODE_HANDLE_CLASSNAME}>
      <CanvasCard
        tone={kind === 'value' ? 'value' : undefined}
        compact={compact}
        compactContent={compactContent}
        contentHidden={hidden}
        footerHidden={hidden && !runContent}
        title={title}
        icon={<CanvasNodeIcon icon={node.icon} kind={node.kind} nodeType={nodeStore.nodeType} />}
        subtitle={subtitle}
        subtitleAccessory={
          actions != null && actions.count > 0 ? (
            <CanvasTooltip placement="top" title={actionLabel}>
              <span className="inline-flex shrink-0" tabIndex={0} role="img" aria-label={actionLabel}>
                <IconStack icons={actions.providers} count={actions.count} limit={5} size="sm" countClassName="font-normal text-inherit" />
              </span>
            </CanvasTooltip>
          ) : undefined
        }
        selected={selected}
        problem={(node.kind == 'task' || node.kind == 'trigger') && node.connectionRequired ? t('nodeStatus.connectionRequired') : problem}
        problemIcon={
          (node.kind == 'task' || node.kind == 'trigger') && node.connectionRequired ? <i aria-hidden="true" className="i-lucide-light:unplug" /> : undefined
        }
        branches={branches}
        footer={runContent ? <div className={styles.footer}>{runContent}</div> : undefined}
        preview={
          (values.length > 0 || Boolean(schedules?.length) || (node?.run != null && images.length > 0)) && (
            <>
              {schedules != null && schedules.length > 0 && (
                <NodeContentRows>
                  {schedules.map((schedule, index) => {
                    const description = schedule.type === 'cron' ? cronDescription(schedule.expression, language) : undefined
                    return (
                      <li key={index}>
                        {schedule.type == 'cron' ? (
                          <>
                            <CanvasTooltip
                              placement="top"
                              sideOffset={12}
                              title={
                                <div>
                                  <div>{description}</div>
                                  {description !== schedule.expression && <code>{schedule.expression}</code>}
                                </div>
                              }
                            >
                              <span className={styles.scheduleText} tabIndex={0}>
                                {cronLabel(schedule.expression, language, t)}
                              </span>
                            </CanvasTooltip>
                            <CanvasTooltip placement="top" sideOffset={12} title={<code>{schedule.timezone}</code>}>
                              <span className={styles.timezone} tabIndex={0}>
                                <bdi dir="ltr">{timeZoneLabel(schedule.timezone, t, language)}</bdi>
                              </span>
                            </CanvasTooltip>
                          </>
                        ) : (
                          <span className={`${styles.interval} ${styles.scheduleText}`}>
                            {t('canvasCard.every', { value: schedule.value, unit: t(`canvasCard.shortUnits.${schedule.unit}`) })}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </NodeContentRows>
              )}
              {values.length > 0 && (
                <NodeContentRows>
                  {values.map((item) => {
                    return (
                      <li key={item.handle}>
                        <CanvasTooltip placement="top" sideOffset={12} title={item.handle}>
                          <span className={styles.valueKey} tabIndex={0}>
                            {item.handle}
                          </span>
                        </CanvasTooltip>
                        <ValuePreview name={item.handle} value={item.value} />
                      </li>
                    )
                  })}
                </NodeContentRows>
              )}
              {node?.run && images.length > 0 && <ImagePreview images={images} run={node.run} title={title} />}
            </>
          )
        }
      >
        {!inline && summary && (
          <p className={styles.summary} title={summary}>
            {summary}
          </p>
        )}
      </CanvasCard>
    </div>
  )
}
