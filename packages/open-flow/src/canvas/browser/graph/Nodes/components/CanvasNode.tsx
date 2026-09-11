import styles from './CanvasNode.module.scss'
import type { ReactNode } from 'react'
import type { NodeStore } from '../../../stores/node/node.store.ts'

import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { ContentIcon } from '../../../../../ui/browser/icons/ContentIcon.tsx'
import { NODE_HANDLE_CLASSNAME } from '../../../base/canvas.ts'
import { CanvasTooltip } from '../../../components/tooltip.tsx'
import { nodeCardContent } from '../../FlowCanvas/cardContent.ts'
import { cronDescription, cronLabel } from '../../FlowCanvas/cronDescription.ts'
import { timeZoneLabel } from '../../FlowCanvas/timeZoneLabel.ts'
import { CanvasCard, CardCollapse } from './CanvasCard.tsx'
import { iconForNodeType } from './constants.ts'
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
  const title = node.title
  const icon = node.icon ?? (node.kind == 'wait' ? ':carbon:time:' : undefined)
  const { values, summary, schedules, images, tools, inline, hidden } = nodeCardContent(node)
  const kind = node?.kind ?? 'task'
  const subtitle = inline ? summary : node?.kind == 'task' ? node.executorName || t('canvasCard.kind.task') : t(`canvasCard.kind.${kind}`)
  const distinctSubtitle = subtitle.trim().toLocaleLowerCase() == title.trim().toLocaleLowerCase() ? undefined : subtitle
  const toolContent = tools != null && tools.length > 0 && (
    <div className={styles.tools}>
      <span className={styles.toolsLabel}>{t('canvasCard.tools')}</span>
      <div className={styles.toolItems}>
        {tools.slice(0, 6).map((tool) => (
          <CanvasTooltip key={tool.id} placement="top" title={tool.label}>
            <span className={styles.tool} aria-label={tool.label} tabIndex={0}>
              <ContentIcon src={tool.icon} />
            </span>
          </CanvasTooltip>
        ))}
        {tools.length > 6 && (
          <CanvasTooltip
            placement="top"
            title={
              <div>
                {tools.slice(6).map((tool) => (
                  <div key={tool.id}>{tool.label}</div>
                ))}
              </div>
            }
          >
            <span className={styles.moreTools} tabIndex={0}>
              +{tools.length - 6}
            </span>
          </CanvasTooltip>
        )}
      </div>
    </div>
  )
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
        icon={<ContentIcon src={icon} fallback={<i className={iconForNodeType(nodeStore.nodeType)} />} />}
        subtitle={distinctSubtitle}
        selected={selected}
        problem={problem}
        branches={branches}
        footer={
          toolContent || runContent ? (
            <div className={styles.footer}>
              {toolContent &&
                (runContent ? (
                  <CardCollapse hidden={hidden}>
                    <div className={styles.toolsAboveRun}>{toolContent}</div>
                  </CardCollapse>
                ) : (
                  toolContent
                ))}
              {runContent}
            </div>
          ) : undefined
        }
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
                                <bdi dir="ltr">{timeZoneLabel(schedule.timezone, t)}</bdi>
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
